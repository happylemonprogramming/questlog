import { dialog, type BrowserWindow } from 'electron';
import { execFile } from 'node:child_process';
import fs, { existsSync, readFileSync } from 'node:fs';
import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import git from 'isomorphic-git';
import { readConfig, writeConfig } from './config';
import { log } from './log';

/**
 * Folders on this computer the user lets the agent read, so it can build a
 * resume from their projects and commits. Every engine reaches them through
 * Questlog's own tools, which are approved without asking, so the rules live
 * here: only folders the user picked in a dialog, nothing outside them (links
 * included), and never secrets, dependencies, build output or what .gitignore
 * leaves out. Nothing here writes.
 */

const MAX_READ = 10 * 1024 * 1024;
const MAX_PAGE = 200 * 1024;
const MAX_LINE = 1000;
const MAX_ENTRIES = 400;
const MAX_REPOS = 40;
const MAX_COMMITS = 50_000;

/** Folders that are dependencies, build output or tool state: noise, and sometimes secrets. */
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'bower_components', '.ssh', '.gnupg', '.aws', '.azure', '.kube', '.docker', '.password-store',
  'dist', 'build', 'target', '.next', '.nuxt', '.svelte-kit', 'out', '__pycache__', 'venv', '.venv', '.tox',
  '.cache', '.gradle', '.terraform', 'pods', 'vendor', '.ds_store',
]);

/** Files that may hold passwords, keys or other people's data. */
const SECRET = new RegExp(
  '^(?:\\.env.*|.*\\.(?:pem|key|p12|pfx|jks|keystore|kdbx|ppk|asc|gpg|sqlite3?|db|tfstate(?:\\.backup)?)|id_(?:rsa|dsa|ecdsa|ed25519).*' +
    '|\\.netrc|_netrc|\\.npmrc|\\.pypirc|\\.pgpass|\\.htpasswd|\\.git-credentials|\\.dockercfg|credentials(?:\\.\\w+)?' +
    '|.*\\.keychain(?:-db)?|.*secrets?\\.(?:json|ya?ml|toml|txt)|known_hosts|authorized_keys)$',
  'i',
);

const NO_GRANTS = 'The user hasn\'t shared any folders yet. Ask them to pick one (ask_for_folder), or to add one in Settings.';

export interface LocalEntry {
  /** Relative to the listed folder, with forward slashes. */
  path: string;
  type: 'file' | 'dir';
  size?: number;
}

export interface LocalListing {
  root: string;
  entries: LocalEntry[];
  /** Entries left out: secrets, dependencies, build output, ignored files, links leading out. */
  hidden: number;
  truncated: boolean;
}

export interface LocalRead {
  path: string;
  size: number;
  binary: boolean;
  text?: string;
  from?: number;
  to?: number;
  lines?: number;
}

export interface LocalHit {
  path: string;
  nameMatch: boolean;
  lines: { line: number; text: string }[];
}

export interface RepoSummary {
  name: string;
  path: string;
  remote?: string;
  /** The user's commits, by the emails that matched. */
  commits: number;
  emails: string[];
  total: number;
  /** Set when the repo has more commits than were read. */
  capped?: boolean;
  first?: string;
  last?: string;
  languages: { language: string; files: number }[];
  subjects: { date: string; subject: string }[];
  /** The most frequent authors, when none of the user's emails matched. */
  authors?: { email: string; commits: number }[];
  error?: string;
}

export interface GitHistory {
  emails: string[];
  backend: 'git' | 'isomorphic-git';
  repos: RepoSummary[];
  /** More repos were found than were looked at. */
  truncated: boolean;
  ms: number;
}

const posix = (p: string) => p.split(path.sep).join('/');
const fold = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);

/** Whether p is root or inside it, by whole path segments. */
function within(p: string, root: string) {
  const a = fold(p), r = fold(root);
  return a === r || a.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
}

/** Why a file or folder is left out, or null when it isn't. */
function skipReason(name: string): string | null {
  if (SECRET.test(name)) return 'it may hold passwords or keys, so Questlog never reads it';
  if (SKIP_DIRS.has(name.toLowerCase())) return 'it holds dependencies, build output or tool data, not the user\'s own work';
  return null;
}

function isBinary(buf: Buffer) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

interface Rule {
  re: RegExp;
  neg: boolean;
  dirOnly: boolean;
}

/** One .gitignore line as a regex over paths relative to the file's folder. */
function parseRule(line: string): Rule | null {
  let s = line.replace(/\r$/, '');
  if (!s.trim() || s.startsWith('#')) return null;
  s = s.replace(/(?<!\\)\s+$/, '');
  let neg = false;
  if (s.startsWith('!')) {
    neg = true;
    s = s.slice(1);
  } else if (s.startsWith('\\!') || s.startsWith('\\#')) s = s.slice(1);
  const dirOnly = s.endsWith('/');
  if (dirOnly) s = s.slice(0, -1);
  if (!s) return null;
  const anchored = s.includes('/');
  if (s.startsWith('/')) s = s.slice(1);
  const esc = (c: string) => c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  let re = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '*' && s[i + 1] === '*') {
      if (s[i + 2] === '/') (re += '(?:.*/)?'), (i += 2);
      else (re += '.*'), (i += 1);
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '[') {
      const end = s.indexOf(']', i + 2);
      if (end < 0) re += '\\[';
      else {
        const body = s.slice(i + 1, end).replace(/\\/g, '\\\\');
        re += `[${body.startsWith('!') ? `^${body.slice(1)}` : body}]`;
        i = end;
      }
    } else if (c === '\\' && i + 1 < s.length) re += esc(s[++i]);
    else re += esc(c);
  }
  try {
    return { re: new RegExp(`^${anchored ? '' : '(?:.*/)?'}${re}$`), neg, dirOnly };
  } catch {
    return null;
  }
}

/** What git would leave out, from the .gitignore files of the repo a path is in. Cached for one request. */
class Ignores {
  private rules = new Map<string, Rule[]>();
  private roots = new Map<string, string | null>();

  repoRoot(dir: string): string | null {
    const seen: string[] = [];
    let found: string | null = null;
    for (let d = dir; ; d = path.dirname(d)) {
      if (this.roots.has(d)) {
        found = this.roots.get(d)!;
        break;
      }
      seen.push(d);
      if (existsSync(path.join(d, '.git'))) {
        found = d;
        break;
      }
      if (path.dirname(d) === d) break;
    }
    for (const d of seen) this.roots.set(d, found);
    return found;
  }

  private load(dir: string, root: string): Rule[] {
    let rules = this.rules.get(dir);
    if (rules) return rules;
    const text = (f: string) => {
      try {
        return readFileSync(f, 'utf8');
      } catch {
        return '';
      }
    };
    const src = text(path.join(dir, '.gitignore')) + (dir === root ? `\n${text(path.join(root, '.git', 'info', 'exclude'))}` : '');
    rules = src.split('\n').map(parseRule).filter((r): r is Rule => !!r);
    this.rules.set(dir, rules);
    return rules;
  }

  /** Whether git ignores this path itself; its parent folders are checked separately. */
  test(abs: string, isDir: boolean) {
    const root = this.repoRoot(path.dirname(abs));
    if (!root) return false;
    const dirs: string[] = [];
    for (let d = path.dirname(abs); within(d, root); d = path.dirname(d)) {
      dirs.unshift(d);
      if (d === root) break;
    }
    let ignored = false;
    for (const d of dirs) {
      const rel = posix(path.relative(d, abs));
      for (const r of this.load(d, root)) if ((!r.dirOnly || isDir) && r.re.test(rel)) ignored = !r.neg;
    }
    return ignored;
  }
}

interface Walked {
  abs: string;
  rel: string;
  dir: boolean;
  /** A link, which is listed but never followed. */
  link: boolean;
  depth: number;
}

/** Runs a command with a fixed argument list, never through a shell. */
function run(cmd: string, args: string[], opts: { cwd?: string; timeout?: number; maxBuffer?: number } = {}) {
  return new Promise<string>((resolve, reject) => {
    execFile(
      cmd,
      args,
      { cwd: opts.cwd ?? os.tmpdir(), timeout: opts.timeout ?? 20_000, maxBuffer: opts.maxBuffer ?? 64 * 1024 * 1024, windowsHide: true, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
}

/** Git with what a repo's own config could make it run turned off. */
const sysGit = (repo: string, args: string[]) =>
  run('git', ['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'log.showSignature=false', '-C', repo, ...args]);

/** A git config file as "section.key" (or "section.sub.key") → values. */
function parseGitConfig(text: string) {
  const out = new Map<string, string[]>();
  let section = '';
  for (const raw of text.split('\n')) {
    const line = raw.replace(/[#;].*$/, '').trim();
    const head = line.match(/^\[\s*([\w.-]+)(?:\s+"(.*)")?\s*\]$/);
    if (head) {
      section = head[2] !== undefined ? `${head[1].toLowerCase()}.${head[2]}` : head[1].toLowerCase();
      continue;
    }
    const kv = line.match(/^([\w-]+)\s*=\s*(.*)$/);
    if (!kv || !section) continue;
    const key = `${section}.${kv[1].toLowerCase()}`;
    out.set(key, [...(out.get(key) ?? []), kv[2].replace(/^"(.*)"$/, '$1')]);
  }
  return out;
}

const readText = (f: string) => readFile(f, 'utf8').catch(() => '');

/** A remote's URL without any user name or token in it. */
const cleanRemote = (url: string) => url.replace(/^([a-z][\w+.-]*:\/\/)[^@/]+@/i, '$1');

const LANGUAGES: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  py: 'Python', ipynb: 'Jupyter Notebook', rs: 'Rust', go: 'Go', java: 'Java', kt: 'Kotlin', kts: 'Kotlin', scala: 'Scala', swift: 'Swift',
  m: 'Objective-C', mm: 'Objective-C', rb: 'Ruby', php: 'PHP', cs: 'C#', fs: 'F#', c: 'C', h: 'C', cpp: 'C++', cc: 'C++', cxx: 'C++', hpp: 'C++',
  clj: 'Clojure', cljs: 'Clojure', ex: 'Elixir', exs: 'Elixir', erl: 'Erlang', hs: 'Haskell', ml: 'OCaml', lua: 'Lua', dart: 'Dart', r: 'R',
  jl: 'Julia', sh: 'Shell', bash: 'Shell', zsh: 'Shell', fish: 'Shell', ps1: 'PowerShell', sql: 'SQL', html: 'HTML', css: 'CSS', scss: 'CSS',
  sass: 'CSS', less: 'CSS', vue: 'Vue', svelte: 'Svelte', astro: 'Astro', tf: 'Terraform', nix: 'Nix', zig: 'Zig', sol: 'Solidity', gd: 'GDScript',
  elm: 'Elm', v: 'Verilog', sv: 'SystemVerilog', vhd: 'VHDL', cu: 'CUDA', glsl: 'GLSL', wgsl: 'WGSL', pl: 'Perl', groovy: 'Groovy', nim: 'Nim',
};

function languages(files: string[]) {
  const counts = new Map<string, number>();
  for (const f of files) {
    const base = f.slice(f.lastIndexOf('/') + 1);
    const dot = base.lastIndexOf('.');
    const lang = base === 'Dockerfile' ? 'Dockerfile' : dot > 0 ? LANGUAGES[base.slice(dot + 1).toLowerCase()] : undefined;
    if (lang) counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([language, files]) => ({ language, files }));
}

/** A commit time in the author's own time zone, as git's %aI gives it, so dates match either way. */
function isoAt(seconds: number, offsetMinutes: number) {
  const wall = new Date((seconds - offsetMinutes * 60) * 1000).toISOString().slice(0, 19);
  const east = -offsetMinutes;
  const hm = `${String(Math.floor(Math.abs(east) / 60)).padStart(2, '0')}:${String(Math.abs(east) % 60).padStart(2, '0')}`;
  return `${wall}${east < 0 ? '-' : '+'}${hm}`;
}

interface Commit {
  at: string;
  email: string;
  subject: string;
}

/** The latest commits plus a spread across the rest, so a long history shows its whole arc. */
function sampleSubjects(mine: Commit[]) {
  const picked: Commit[] = mine.slice(0, 25);
  const rest = mine.slice(25);
  const spread = Math.min(15, rest.length);
  for (let i = 0; i < spread; i++) picked.push(rest[Math.floor((i * rest.length) / spread)]);
  const seen = new Set<string>();
  return picked
    .filter((c) => {
      const k = c.subject.trim().toLowerCase();
      return k && !seen.has(k) && !!seen.add(k);
    })
    .map((c) => ({ date: c.at.slice(0, 10), subject: c.subject.slice(0, 160) }));
}

export class LocalFolders {
  private gitPath: string | undefined;
  private gitFound: Promise<boolean> | null = null;

  grants(): string[] {
    const f = readConfig().folders;
    return Array.isArray(f) ? f.filter((x): x is string => typeof x === 'string') : [];
  }

  /** Let the user pick a folder for the agent to read. The only way a folder is ever added. */
  async grant(win: BrowserWindow | null) {
    const opts = { title: "Let Questlog's agent read a folder", buttonLabel: 'Share this folder', properties: ['openDirectory'] as 'openDirectory'[] };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled || !res.filePaths[0]) return null;
    const folder = await realpath(res.filePaths[0]);
    const grants = this.grants();
    if (!grants.some((g) => fold(g) === fold(folder))) writeConfig({ folders: [...grants, folder] });
    log('local:grant', folder);
    return { folder, grants: this.grants() };
  }

  revoke(folder: string) {
    writeConfig({ folders: this.grants().filter((g) => fold(g) !== fold(String(folder))) });
    log('local:revoke', folder);
    return this.grants();
  }

  /**
   * A path as the real file it names, refusing anything outside the granted
   * folders (after following links) or that is skipped. Relative paths are
   * tried against each grant in turn.
   */
  private async locate(p: string | undefined, ign: Ignores): Promise<{ abs: string; grant: string; dir: boolean }> {
    const grants = this.grants();
    if (!grants.length) throw new Error(NO_GRANTS);
    let raw = String(p ?? '').trim();
    if (!raw) {
      if (grants.length > 1) throw new Error(`Say which folder: ${grants.join(', ')}.`);
      raw = grants[0];
    }
    if (raw.includes('\0')) throw new Error('Not a valid path.');
    if (raw === '~' || raw.startsWith('~/') || raw.startsWith('~\\')) raw = path.join(os.homedir(), raw.slice(1));
    const candidates = path.isAbsolute(raw) ? [path.resolve(raw)] : grants.map((g) => path.resolve(g, raw));
    let outside = false;
    for (const c of candidates) {
      const real = await realpath(c).catch(() => null);
      if (!real) {
        if (!grants.some((g) => within(c, g))) outside = true;
        continue;
      }
      const grant = grants.find((g) => within(real, g));
      if (!grant) {
        outside = true;
        continue;
      }
      const dir = (await stat(real)).isDirectory();
      this.check(real, grant, dir, ign);
      return { abs: real, grant, dir };
    }
    throw new Error(outside ? `${raw} is outside the folders the user shared.` : `${raw} doesn't exist in the shared folders.`);
  }

  /** Refuses a path below its grant that is, or is inside, something skipped. */
  private check(abs: string, grant: string, dir: boolean, ign: Ignores) {
    const segs = path.relative(grant, abs).split(path.sep).filter(Boolean);
    for (let i = 0; i < segs.length; i++) {
      const why = skipReason(segs[i]);
      if (why) throw new Error(`${posix(segs.slice(0, i + 1).join('/'))} is skipped: ${why}.`);
      const at = path.join(grant, ...segs.slice(0, i + 1));
      if (ign.test(at, i < segs.length - 1 || dir)) throw new Error(`${posix(segs.slice(0, i + 1).join('/'))} is skipped: the project's .gitignore leaves it out.`);
    }
  }

  /**
   * Visits what's under a folder, leaving out skipped and ignored entries and
   * links that lead outside the grants. Links are listed but never followed.
   * `visit` returns false to not go into a folder, or 'stop' to end the walk.
   */
  private async walk(root: string, maxDepth: number, ign: Ignores, visit: (e: Walked) => boolean | void | 'stop', budget = { deadline: Infinity }) {
    let hidden = 0;
    let stopped = false;
    const grants = this.grants();
    const go = async (dir: string, depth: number) => {
      const ents = await readdir(dir, { withFileTypes: true }).catch(() => []);
      ents.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
      for (const e of ents) {
        if (stopped || Date.now() > budget.deadline) return void (stopped = true);
        const abs = path.join(dir, e.name);
        let isDir = e.isDirectory();
        const link = e.isSymbolicLink();
        if (link) {
          const real = await realpath(abs).catch(() => null);
          const grant = real && grants.find((g) => within(real, g));
          if (!real || !grant) {
            hidden++;
            continue;
          }
          try {
            isDir = (await stat(real)).isDirectory();
            this.check(real, grant, isDir, ign);
          } catch {
            hidden++;
            continue;
          }
        } else if (!isDir && !e.isFile()) continue;
        if (skipReason(e.name) || ign.test(abs, isDir)) {
          hidden++;
          continue;
        }
        const r = visit({ abs, rel: posix(path.relative(root, abs)), dir: isDir, link, depth });
        if (r === 'stop') return void (stopped = true);
        if (isDir && !link && r !== false && depth + 1 < maxDepth) await go(abs, depth + 1);
      }
    };
    await go(root, 0);
    return { hidden, stopped };
  }

  /** What's in a folder, as a tree down to `depth`. With no path and several grants, each grant. */
  async list(p?: string, depth = 2): Promise<LocalListing[]> {
    const ign = new Ignores();
    const grants = this.grants();
    if (!grants.length) throw new Error(NO_GRANTS);
    const roots = !p?.trim() ? grants : [await this.locate(p, ign)].map((l) => {
      if (!l.dir) throw new Error(`${p} is a file; read it with read_local.`);
      return l.abs;
    });
    const d = Math.max(1, Math.min(6, Math.floor(depth) || 2));
    const per = Math.max(50, Math.floor(MAX_ENTRIES / roots.length));
    const out: LocalListing[] = [];
    for (const root of roots) {
      const entries: { e: LocalEntry; abs: string }[] = [];
      const { hidden, stopped } = await this.walk(root, d, ign, (w) => {
        if (entries.length >= per) return 'stop';
        entries.push({ e: { path: w.rel, type: w.dir ? 'dir' : 'file' }, abs: w.abs });
      });
      for (const x of entries) if (x.e.type === 'file') x.e.size = (await stat(x.abs).catch(() => null))?.size;
      out.push({ root, entries: entries.map((x) => x.e), hidden, truncated: stopped });
    }
    return out;
  }

  /** A text file's lines from `offset` (1-based), at most `limit` of them and MAX_PAGE of text. */
  async read(p: string, offset = 1, limit = 400): Promise<LocalRead> {
    const { abs, dir } = await this.locate(p, new Ignores());
    if (dir) throw new Error(`${p} is a folder; list it with list_local.`);
    const size = (await stat(abs)).size;
    if (size > MAX_READ) throw new Error(`${p} is ${Math.round(size / 1024 / 1024)} MB, too large to read.`);
    const buf = await readFile(abs);
    if (isBinary(buf)) return { path: abs, size, binary: true };
    const all = buf.toString('utf8').split('\n');
    const from = Math.max(1, Math.floor(offset) || 1);
    const want = Math.max(1, Math.min(2000, Math.floor(limit) || 400));
    let text = '';
    let to = from - 1;
    for (const line of all.slice(from - 1, from - 1 + want)) {
      const l = line.length > MAX_LINE ? `${line.slice(0, MAX_LINE)} [line cut]` : line;
      if (text.length + l.length > MAX_PAGE && to >= from) break;
      text += (to >= from ? '\n' : '') + l;
      to++;
    }
    return { path: abs, size, binary: false, text, from, to, lines: all.length };
  }

  /** Files whose name or text contains the query, ignoring case, with a few matching lines each. */
  async search(query: string, p?: string): Promise<{ query: string; results: LocalHit[]; scanned: number; truncated: boolean }> {
    const q = String(query ?? '').toLowerCase().trim();
    if (q.length < 2) throw new Error('Search for at least 2 characters.');
    const ign = new Ignores();
    const grants = this.grants();
    if (!grants.length) throw new Error(NO_GRANTS);
    const roots = p?.trim() ? [(await this.locate(p, ign)).abs] : grants;
    const results: LocalHit[] = [];
    const budget = { deadline: Date.now() + 15_000 };
    let scanned = 0, bytes = 0, truncated = false;
    for (const root of roots) {
      const files: string[] = [];
      const { stopped } = await this.walk(root, 12, ign, (w) => {
        if (files.length >= 4000) return 'stop';
        if (!w.dir) files.push(w.abs);
      }, budget);
      truncated ||= stopped;
      for (const abs of files) {
        if (results.length >= 40 || bytes > 30 * 1024 * 1024 || Date.now() > budget.deadline) {
          truncated = true;
          break;
        }
        const hit: LocalHit = { path: abs, nameMatch: path.basename(abs).toLowerCase().includes(q), lines: [] };
        const real = await realpath(abs).catch(() => abs);
        const size = (await stat(real).catch(() => null))?.size ?? Infinity;
        if (size <= 512 * 1024) {
          scanned++;
          bytes += size;
          const buf = await readFile(real).catch(() => null);
          if (buf && !isBinary(buf)) {
            const lines = buf.toString('utf8').split('\n');
            for (let i = 0; i < lines.length && hit.lines.length < 3; i++) {
              if (lines[i].toLowerCase().includes(q)) hit.lines.push({ line: i + 1, text: lines[i].trim().slice(0, 200) });
            }
          }
        }
        if (hit.nameMatch || hit.lines.length) results.push(hit);
      }
    }
    return { query, results, scanned, truncated };
  }

  /** Whether git is installed, checked again when PATH changes. */
  private hasGit() {
    if (!this.gitFound || this.gitPath !== process.env.PATH) {
      this.gitPath = process.env.PATH;
      this.gitFound = run('git', ['--version'], { timeout: 5000 }).then(() => true, () => false);
    }
    return this.gitFound;
  }

  private async globalEmails(useGit: boolean): Promise<string[]> {
    if (useGit) {
      const out = await run('git', ['config', '--global', '--get-all', 'user.email'], { timeout: 5000 }).catch(() => '');
      return out.split('\n').map((s) => s.trim()).filter(Boolean);
    }
    const home = os.homedir();
    const files = process.env.GIT_CONFIG_GLOBAL
      ? [process.env.GIT_CONFIG_GLOBAL]
      : [path.join(home, '.gitconfig'), path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'git', 'config')];
    const out: string[] = [];
    for (const f of files) out.push(...(parseGitConfig(await readText(f)).get('user.email') ?? []));
    return out;
  }

  /** Git repositories under a folder: the folder itself, or folders a few levels down that hold a .git. */
  private async findRepos(root: string, ign: Ignores, found: string[], deadline: number) {
    if (existsSync(path.join(root, '.git'))) return void found.push(root);
    let more = false;
    await this.walk(root, 5, ign, (w) => {
      if (!w.dir || w.link) return false;
      if (found.length >= MAX_REPOS) return (more = true), 'stop';
      if (existsSync(path.join(w.abs, '.git'))) {
        found.push(w.abs);
        return false;
      }
    }, { deadline });
    return more;
  }

  /** The repo's git folder, which a worktree or submodule keeps elsewhere; only if it's inside a grant too. */
  private async gitDir(repo: string) {
    const dotgit = path.join(repo, '.git');
    const s = await lstat(dotgit);
    if (s.isDirectory()) return dotgit;
    const m = (await readText(dotgit)).match(/^gitdir:\s*(.+)$/m);
    if (!m) return null;
    const real = await realpath(path.resolve(repo, m[1].trim())).catch(() => null);
    return real && this.grants().some((g) => within(real, g)) ? real : null;
  }

  /**
   * The user's commits in every repository under the granted folders (or one
   * path): how many, when, in which languages, and a sample of what they said.
   * The user is known by the given emails, their global git email and each
   * repo's own. Uses git if it's installed, otherwise reads the repos directly.
   */
  async gitHistory(p?: string, opts: { emails?: string[] } = {}): Promise<GitHistory> {
    const started = Date.now();
    const deadline = started + 90_000;
    const ign = new Ignores();
    const grants = this.grants();
    if (!grants.length) throw new Error(NO_GRANTS);
    const roots = p?.trim() ? [await this.locate(p, ign)].map((l) => {
      if (!l.dir) throw new Error(`${p} is a file, not a folder.`);
      return l.abs;
    }) : grants;
    const useGit = await this.hasGit();
    const known = new Set([...(opts.emails ?? []), ...(await this.globalEmails(useGit))].map((e) => String(e).trim().toLowerCase()).filter(Boolean));
    const repos: string[] = [];
    let truncated = false;
    for (const root of roots) {
      if (repos.length >= MAX_REPOS) {
        truncated = true;
        break;
      }
      if (await this.findRepos(root, ign, repos, deadline)) truncated = true;
    }
    const unique = [...new Set(repos)].slice(0, MAX_REPOS);

    const out: RepoSummary[] = new Array(unique.length);
    let next = 0;
    const worker = async () => {
      while (next < unique.length) {
        const i = next++;
        const repo = unique[i];
        if (Date.now() > deadline) {
          out[i] = { name: path.basename(repo), path: repo, commits: 0, emails: [], total: 0, languages: [], subjects: [], error: 'Skipped: ran out of time.' };
          continue;
        }
        out[i] = await this.summarize(repo, known, useGit, deadline).catch((e) => ({
          name: path.basename(repo), path: repo, commits: 0, emails: [], total: 0, languages: [], subjects: [], error: String((e as Error)?.message ?? e).split('\n')[0].slice(0, 300),
        }));
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    return { emails: [...known], backend: useGit ? 'git' : 'isomorphic-git', repos: out, truncated, ms: Date.now() - started };
  }

  private async summarize(repo: string, known: Set<string>, useGit: boolean, deadline: number): Promise<RepoSummary> {
    const gitdir = await this.gitDir(repo);
    if (!gitdir) throw new Error('Its git folder is outside the shared folders.');
    const config = parseGitConfig(await readText(path.join(gitdir, 'config')));
    const emails = new Set(known);
    for (const e of config.get('user.email') ?? []) emails.add(e.trim().toLowerCase());
    const remote = config.get('remote.origin.url')?.[0];

    let commits: Commit[];
    let files: string[];
    let capped = false;
    if (useGit) {
      const logOut = await sysGit(repo, ['log', '--all', '--no-merges', '--no-show-signature', `--max-count=${MAX_COMMITS}`, '--pretty=format:%aI%x09%ae%x09%s']).catch((e) => {
        // A repo with no commits yet has nothing to log.
        if (/does not have any commits|bad default revision/i.test(String(e?.stderr ?? e))) return '';
        throw e;
      });
      commits = logOut.split('\n').filter(Boolean).map((l) => {
        const [at, email, ...subject] = l.split('\t');
        return { at, email: email.toLowerCase(), subject: subject.join('\t') };
      });
      files = (await sysGit(repo, ['ls-files', '-z']).catch(() => '')).split('\0').filter(Boolean);
      capped = commits.length >= MAX_COMMITS;
    } else {
      ({ commits, capped } = await this.isoLog(repo, gitdir, Math.min(deadline, Date.now() + 15_000)));
      files = await git.listFiles({ fs, dir: repo, gitdir }).catch(() => [] as string[]);
    }

    const mine = commits.filter((c) => emails.has(c.email)).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const summary: RepoSummary = {
      name: path.basename(repo),
      path: repo,
      ...(remote ? { remote: cleanRemote(remote) } : {}),
      commits: mine.length,
      emails: [...new Set(mine.map((c) => c.email))],
      total: commits.length,
      ...(capped ? { capped: true } : {}),
      first: mine.at(-1)?.at.slice(0, 10),
      last: mine[0]?.at.slice(0, 10),
      languages: languages(files),
      subjects: sampleSubjects(mine),
    };
    if (!mine.length && commits.length) {
      const tally = new Map<string, number>();
      for (const c of commits) tally.set(c.email, (tally.get(c.email) ?? 0) + 1);
      summary.authors = [...tally].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([email, n]) => ({ email, commits: n }));
    }
    return summary;
  }

  /**
   * Every branch's and remote branch's history, read without git installed.
   * Walked one commit at a time, each once, so it can stop at the deadline.
   */
  private async isoLog(dir: string, gitdir: string, deadline: number): Promise<{ commits: Commit[]; capped: boolean }> {
    const refs = new Set<string>(['HEAD']);
    for (const r of await git.listRefs({ fs, dir, gitdir, filepath: 'refs' }).catch(() => [] as string[])) refs.add(`refs/${r}`);
    const todo: string[] = [];
    for (const ref of refs) {
      const oid = await git.resolveRef({ fs, dir, gitdir, ref }).catch(() => null);
      if (oid) todo.push(oid);
    }
    const seen = new Set<string>();
    const commits: Commit[] = [];
    const cache = {};
    while (todo.length) {
      if (seen.size >= MAX_COMMITS || Date.now() > deadline) return { commits, capped: true };
      const oid = todo.pop()!;
      if (seen.has(oid)) continue;
      seen.add(oid);
      const c = await git.readCommit({ fs, dir, gitdir, oid, cache }).catch(() => null);
      // An annotated tag's oid peels to its commit, which may have been seen already.
      if (!c || (c.oid !== oid && seen.has(c.oid))) continue;
      seen.add(c.oid);
      todo.push(...c.commit.parent);
      if (c.commit.parent.length > 1) continue;
      const a = c.commit.author;
      commits.push({ at: isoAt(a.timestamp, a.timezoneOffset), email: a.email.toLowerCase(), subject: c.commit.message.split('\n')[0] });
    }
    return { commits, capped: false };
  }
}
