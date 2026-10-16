import { app } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The desktop app's own settings, the ones the main process needs before the
 * window exists: where the workspace is, and which of your folders the agent
 * may read. Kept in the app's data folder, never in the workspace.
 */
export interface Config {
  workspace?: string;
  /** Folders the user granted the agent to read, as absolute paths. */
  folders?: string[];
}

const file = () => path.join(app.getPath('userData'), 'questlog.json');

export function readConfig(): Config {
  try {
    return JSON.parse(readFileSync(file(), 'utf8')) as Config;
  } catch {
    return {};
  }
}

export function writeConfig(patch: Partial<Config>) {
  const next = { ...readConfig(), ...patch };
  writeFileSync(file(), JSON.stringify(next, null, 2));
  return next;
}
