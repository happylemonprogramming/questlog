import { app, BrowserWindow } from 'electron';
import { existsSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { log } from './log';

/**
 * Questlog was called Offerdex. Its data folder and its app:// origin had the
 * old name, so on first start the folder is moved across, and the records in
 * the old origin's IndexedDB are handed to the window once to keep.
 */

const OLD_DIRS = ['offerdex-desktop', 'Offerdex'];
const DONE = 'offerdex-migrated';

/** Use one data folder, named questlog, in development and when packaged. Call before the app is ready. */
export function useDataFolder() {
  const appData = app.getPath('appData');
  const dir = path.join(appData, 'questlog');
  if (!existsSync(dir)) {
    const old = OLD_DIRS.map((d) => path.join(appData, d)).find((d) => existsSync(d));
    if (old) {
      try {
        renameSync(old, dir);
      } catch (e) {
        console.error(`Couldn't move ${old} to ${dir}:`, e);
      }
    }
  }
  app.setPath('userData', dir);
}

const DUMP = `new Promise((resolve, reject) => {
  const open = indexedDB.open('offerdex');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    const names = [...db.objectStoreNames];
    if (!names.length) return resolve(null);
    const tx = db.transaction(names, 'readonly');
    const out = {};
    for (const n of names) {
      const r = tx.objectStore(n).getAll();
      r.onsuccess = () => (out[n] = r.result);
    }
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
  };
})`;

/** The old origin's records, table by table, or null when there are none or they were already taken. */
export async function legacyData(): Promise<Record<string, unknown[]> | null> {
  const flag = path.join(app.getPath('userData'), DONE);
  if (existsSync(flag) || !existsSync(path.join(app.getPath('userData'), 'IndexedDB', 'app_offerdex_0.indexeddb.leveldb'))) return null;
  const page = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  try {
    await page.loadURL('app://offerdex/__blank');
    return (await page.webContents.executeJavaScript(DUMP)) as Record<string, unknown[]> | null;
  } catch (e) {
    log('legacy:failed', (e as Error).message);
    return null;
  } finally {
    page.destroy();
  }
}

export function legacyTaken() {
  writeFileSync(path.join(app.getPath('userData'), DONE), new Date().toISOString());
}
