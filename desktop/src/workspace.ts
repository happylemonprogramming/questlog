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
/** Pictures in the image library, kept as real image files and passed as base64. */
const IMAGE = /^images\/(originals\/)?[^/]+\.(png|jpe?g|webp|gif|svg)$/i;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|svg)$/i;
const MAX_FILE = 4 * 1024 * 1024;
const MAX_IMAGE = 10 * 1024 * 1024;

/** A text file, or with `base64`, an image. */
export interface WsFile {
  path: string;
  text?: string;
  base64?: string;
}

const posix = (p: string) => p.split(path.sep).join('/');
const isImage = (rel: string) => IMAGE.test(rel);

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
        else if (e.isFile()) {
          const rel = posix(path.relative(this.root!, abs));
          if (isImage(rel)) {
            if ((await stat(abs)).size <= MAX_IMAGE) out.push({ path: rel, base64: (await readFile(abs)).toString('base64') });
          } else if (TEXT.test(e.name) && (await stat(abs)).size <= MAX_FILE) {
            out.push({ path: rel, text: await readFile(abs, 'utf8') });
          }
        }
      }
    };
    await walk(this.root, 0);
    return out;
  }

  /** Some files' text (an image's base64), or null for those that are gone. */
  async read(paths: string[]): Promise<{ path: string; text: string | null }[]> {
    return Promise.all(paths.map(async (p) => ({ path: p, text: await readFile(this.resolve(p), isImage(posix(p)) ? 'base64' : 'utf8').catch(() => null) })));
  }

  async write(files: WsFile[], message: string) {
    let n = 0;
    for (const f of files) {
      const abs = this.resolve(f.path);
      const image = f.base64 !== undefined;
      if (image && !isImage(posix(f.path))) throw new Error(`${f.path}: images go in images/.`);
      const content = image ? f.base64! : f.text ?? '';
      const prev = await readFile(abs, image ? 'base64' : 'utf8').catch(() => null);
      if (prev === content) continue;
      await mkdir(path.dirname(abs), { recursive: true });
      this.wrote.set(posix(f.path), content);
      await writeFile(abs, image ? Buffer.from(content, 'base64') : content);
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
      else if (!left.some((n) => TEXT.test(n) || IMAGE_EXT.test(n) || n === 'originals')) await shell.trashItem(dir).catch(() => {});
    }
    this.history.schedule(message);
  }

  private watch() {
    this.watcher?.close();
    try {
      this.watcher = watch(this.root!, { recursive: true }, (_e, name) => {
        if (!name) return;
        const rel = posix(String(name));
        if (rel.split('/').some((s) => s.startsWith('.')) || !(TEXT.test(rel) || isImage(rel))) return;
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
  the .json and .css files its resume and cover letter, and application.json the
  application form's answers, once they're ready for you to review and send.
- documents/: resumes, letters and answers not tied to one job.
- images/: logos and pictures your documents use, by name. originals/ keeps each
  one as it was before it was edited.

PDFs are made again whenever they're needed, so deleting them is safe.
Questlog keeps a history of every change; see Settings > Your files.
`;
