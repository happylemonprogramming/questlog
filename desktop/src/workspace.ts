import { app, dialog, shell, type BrowserWindow, type WebContents } from 'electron';
import { watch, type FSWatcher } from 'node:fs';
import { mkdir, readdir, readFile, realpath, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readConfig, writeConfig } from './config';
import { History } from './history';
import { log } from './log';

/**
 * The workspace: a plain folder (by default ~/Documents/Questlog) that holds
 * your profile, jobs and documents as files you can open, back up and edit
 * yourself. The window's IndexedDB is a cache of it. The window decides what
 * the files say (src/lib/disk.ts); this side only reads and writes them, and
 * never outside the folder.
 */

/** Files the app reads back. Anything else in the folder (PDFs, your own notes) is left alone. */
const TEXT = /\.(md|json|css)$/i;
const MAX_FILE = 4 * 1024 * 1024;

export interface WsFile {
  path: string;
  text: string;
}

const posix = (p: string) => p.split(path.sep).join('/');

export class Workspace {
  root: string | null = null;
  readonly history = new History();
  private watcher: FSWatcher | null = null;
  /** What this app last wrote to each file, so its own writes don't come back as outside edits. */
  private wrote = new Map<string, string | null>();
  private changed = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private window: () => WebContents | undefined) {}

  defaultRoot() {
    return path.join(app.getPath('documents'), 'Questlog');
  }

  async start() {
    const root = readConfig().workspace;
    if (root) await this.open(root).catch((e) => log('workspace:open-failed', (e as Error).message));
  }

  info() {
    return { root: this.root, defaultRoot: this.defaultRoot(), history: this.history.enabled };
  }

  /** Use a folder as the workspace, creating it if needed. */
  async open(dir: string) {
    await mkdir(dir, { recursive: true });
    this.root = await realpath(dir);
    writeConfig({ workspace: this.root });
    const readme = path.join(this.root, 'README.md');
    await stat(readme).catch(() => writeFile(readme, README));
    this.watch();
    await this.history.open(this.root);
    log('workspace:open', { root: this.root, history: this.history.enabled });
    return this.info();
  }

  /** Let the user pick the folder. */
  async choose(win: BrowserWindow | null) {
    const opts = {
      title: 'Choose where Questlog keeps your files',
      defaultPath: this.root ?? this.defaultRoot(),
      buttonLabel: 'Use this folder',
      properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[],
    };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled || !res.filePaths[0]) return null;
    return this.open(res.filePaths[0]);
  }

  reveal() {
    if (this.root) void shell.openPath(this.root);
  }

  /** A workspace-relative path as an absolute one, refusing anything that leaves the folder. */
  private resolve(rel: string) {
    if (!this.root) throw new Error('No workspace folder is set.');
    const abs = path.resolve(this.root, rel);
    if (abs !== this.root && !abs.startsWith(this.root + path.sep)) throw new Error(`${rel} is outside the workspace.`);
    return abs;
  }

  /** Every file the app reads back, with its text. */
  async readAll(): Promise<WsFile[]> {
    if (!this.root) return [];
    const out: WsFile[] = [];
    const walk = async (dir: string, depth: number) => {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const abs = path.join(dir, e.name);
        // Links could point anywhere; the workspace is only what's really in it.
        if (e.isDirectory() && depth < 4) await walk(abs, depth + 1);
        else if (e.isFile() && TEXT.test(e.name)) {
          const s = await stat(abs);
          if (s.size <= MAX_FILE) out.push({ path: posix(path.relative(this.root!, abs)), text: await readFile(abs, 'utf8') });
        }
      }
    };
    await walk(this.root, 0);
    return out;
  }

  /** Some files' text, or null for those that are gone. */
  async read(paths: string[]): Promise<{ path: string; text: string | null }[]> {
    return Promise.all(paths.map(async (p) => ({ path: p, text: await readFile(this.resolve(p), 'utf8').catch(() => null) })));
  }

  async write(files: WsFile[], message: string) {
    let n = 0;
    for (const f of files) {
      const abs = this.resolve(f.path);
      const prev = await readFile(abs, 'utf8').catch(() => null);
      if (prev === f.text) continue;
      await mkdir(path.dirname(abs), { recursive: true });
      this.wrote.set(posix(f.path), f.text);
      await writeFile(abs, f.text);
      n++;
    }
    if (n) this.history.schedule(message);
    return n;
  }

  /**
   * Remove files. A folder left with nothing the app reads (only PDFs, say)
   * goes to the trash with whatever is left in it, so nothing is lost for good.
   */
  async remove(paths: string[], message: string) {
    const dirs = new Set<string>();
    for (const p of paths) {
      const abs = this.resolve(p);
      this.wrote.set(posix(p), null);
      await unlink(abs).catch(() => {});
      dirs.add(path.dirname(abs));
    }
    for (const dir of dirs) {
      if (dir === this.root) continue;
      const left = await readdir(dir).catch(() => null);
      if (!left) continue;
      if (!left.length) await rmdir(dir).catch(() => {});
      else if (!left.some((n) => TEXT.test(n))) await shell.trashItem(dir).catch(() => {});
    }
    this.history.schedule(message);
  }

  private watch() {
    this.watcher?.close();
    try {
      this.watcher = watch(this.root!, { recursive: true }, (_e, name) => {
        if (!name) return;
        const rel = posix(String(name));
        if (rel.split('/').some((s) => s.startsWith('.')) || !TEXT.test(rel)) return;
        this.changed.add(rel);
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.flushChanges(), 400);
      });
    } catch (e) {
      log('workspace:watch-failed', (e as Error).message);
    }
  }

  /** Tell the window about files changed by something other than this app: your editor, a coding agent, a restore. */
  private async flushChanges() {
    const paths = [...this.changed];
    this.changed.clear();
    const outside: string[] = [];
    for (const { path: p, text } of await this.read(paths).catch(() => [])) {
      if (this.wrote.has(p) && this.wrote.get(p) === text) continue;
      this.wrote.delete(p);
      outside.push(p);
    }
    if (outside.length) {
      this.window()?.send('ws:changed', { paths: outside });
      if (Date.now() - this.history.restoredAt > 3000) this.history.schedule('Edited outside Questlog');
    }
  }
}

const README = `# Questlog

This folder is your job search: your profile, every job you track, and the
resumes and letters written for each. Questlog reads and writes it as you
work, and picks up changes you make here yourself.

- profile/: who you are. career.md is your full career record; every resume is written from it.
- jobs/: one folder per job. job.md holds its details and your notes, posting.md the posting,
  and the .json and .css files its resume and cover letter.
- documents/: resumes, letters and answers not tied to one job.

PDFs are made again whenever they're needed, so deleting them is safe.
Questlog keeps a history of every change; see Settings > Your files.
`;
