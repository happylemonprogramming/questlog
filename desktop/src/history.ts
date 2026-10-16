import { app } from 'electron';
import { createHash } from 'node:crypto';
import fs, { existsSync } from 'node:fs';
import { mkdir, rm, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import git from 'isomorphic-git';
import { log } from './log';

/**
 * Every change to the workspace, kept as a snapshot so it can be undone. It's
 * git underneath (isomorphic-git, so nothing to install), but the user only
 * ever sees History and Undo. The history lives in the app's data folder
 * rather than in the workspace, because Documents is often synced by OneDrive
 * or iCloud, and sync services corrupt git folders. PDFs are left out: they're
 * made again from the documents.
 */

const AUTHOR = { name: 'Questlog', email: 'questlog@localhost' };
const EXCLUDE = ['*.pdf', '.DS_Store', 'Thumbs.db', 'desktop.ini', '*.tmp', '~$*', '.~lock.*', '.git'].join('\n');

export interface Snapshot {
  oid: string;
  message: string;
  at: number;
}

/** Whether a folder sits inside a git repository the user already has. */
function inRepo(dir: string) {
  for (let d = dir; ; d = path.dirname(d)) {
    if (existsSync(path.join(d, '.git'))) return true;
    if (path.dirname(d) === d) return false;
  }
}

export class History {
  private gitdir = '';
  private dir = '';
  private messages: string[] = [];
  private timer: NodeJS.Timeout | null = null;
  private busy: Promise<unknown> = Promise.resolve();
  /** Off when the workspace is already in the user's own repository, which is its history. */
  enabled = false;
  /** When the last restore wrote its files, so the watcher doesn't report them as outside edits. */
  restoredAt = 0;

  async open(dir: string) {
    this.dir = dir;
    this.enabled = !inRepo(dir);
    if (!this.enabled) return;
    const id = createHash('sha1').update(path.resolve(dir)).digest('hex').slice(0, 12);
    this.gitdir = path.join(app.getPath('userData'), 'history', `${id}.git`);
    if (!existsSync(path.join(this.gitdir, 'HEAD'))) {
      await mkdir(this.gitdir, { recursive: true });
      await git.init({ fs, dir, gitdir: this.gitdir, defaultBranch: 'main' });
      await writeFile(path.join(this.gitdir, 'description'), `Questlog history of ${dir}\n`);
    }
    await mkdir(path.join(this.gitdir, 'info'), { recursive: true });
    await writeFile(path.join(this.gitdir, 'info', 'exclude'), `${EXCLUDE}\n`);
    await this.commit('Opened the workspace');
  }

  private get repo() {
    return { fs, dir: this.dir, gitdir: this.gitdir };
  }

  /** Take a snapshot shortly, so a burst of saves becomes one entry. */
  schedule(message: string) {
    if (!this.enabled) return;
    if (!this.messages.includes(message)) this.messages.push(message);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      const msgs = this.messages.splice(0);
      void this.commit(msgs.length > 3 ? `${msgs.slice(0, 3).join('; ')} and ${msgs.length - 3} more` : msgs.join('; '));
    }, 2500);
  }

  /** Runs one history operation at a time. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.busy.then(fn, fn);
    this.busy = p.catch(() => {});
    return p;
  }

  commit(message: string): Promise<string | null> {
    if (!this.enabled) return Promise.resolve(null);
    return this.serial(async () => {
      try {
        const rows = await git.statusMatrix(this.repo);
        let changed = 0;
        for (const [filepath, head, work, stage] of rows) {
          if (head === 1 && work === 1 && stage === 1) continue;
          if (work === 0) await git.remove({ ...this.repo, filepath });
          else await git.add({ ...this.repo, filepath });
          changed++;
        }
        const hasHead = await git.resolveRef({ ...this.repo, ref: 'HEAD' }).then(() => true, () => false);
        if (!changed && hasHead) return null;
        return await git.commit({ ...this.repo, message: message || 'Saved', author: AUTHOR });
      } catch (e) {
        log('history:commit-failed', (e as Error).message);
        return null;
      }
    });
  }

  async list(limit = 200): Promise<Snapshot[]> {
    if (!this.enabled) return [];
    try {
      const commits = await git.log({ ...this.repo, depth: limit });
      return commits.map((c) => ({ oid: c.oid, message: c.commit.message.trim(), at: c.commit.author.timestamp * 1000 }));
    } catch {
      return [];
    }
  }

  /**
   * Put the workspace back the way it was at a snapshot. Going back is itself
   * a new snapshot, so it can be undone too.
   */
  restore(oid: string): Promise<string | null> {
    return this.serial(async () => {
      const then = new Set(await git.listFiles({ ...this.repo, ref: oid }));
      const now = await git.listFiles({ ...this.repo, ref: 'HEAD' });
      for (const filepath of then) {
        const { blob } = await git.readBlob({ ...this.repo, oid, filepath });
        const file = path.join(this.dir, filepath);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, blob);
      }
      for (const filepath of now) {
        if (then.has(filepath)) continue;
        await unlink(path.join(this.dir, filepath)).catch(() => {});
        await rmdir(path.dirname(path.join(this.dir, filepath))).catch(() => {});
      }
      this.restoredAt = Date.now();
      const { commit } = await git.readCommit({ ...this.repo, oid });
      return new Date(commit.author.timestamp * 1000).toLocaleString();
    }).then(async (when) => this.commit(`Went back to ${when}`));
  }

  /** Undo the latest snapshot by going back to the one before it. */
  async undo(): Promise<string | null> {
    const [latest, before] = await this.list(2);
    if (!latest || !before) return null;
    await this.restore(before.oid);
    return latest.message;
  }

  /** Forget every snapshot, e.g. to drop old salary notes, and start again from the files as they are. */
  async clear() {
    if (!this.enabled) return;
    await this.serial(() => rm(this.gitdir, { recursive: true, force: true }));
    await this.open(this.dir);
  }
}
