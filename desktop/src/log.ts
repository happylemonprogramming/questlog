import { app } from 'electron';
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * A plain log of what the desktop app and its agents did, so a stall or a
 * crash can be traced afterwards. One file, rolled over at 5 MB.
 */

const MAX = 5 * 1024 * 1024;
let file = '';

export function logDir() {
  return path.join(app.getPath('userData'), 'logs');
}

export function log(event: string, detail?: unknown) {
  try {
    if (!file) {
      mkdirSync(logDir(), { recursive: true });
      file = path.join(logDir(), 'offerdex.log');
    }
    try {
      if (statSync(file).size > MAX) renameSync(file, `${file}.1`);
    } catch {
      // No file yet.
    }
    const text = detail === undefined ? '' : ` ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
    appendFileSync(file, `${new Date().toISOString()} ${event}${text.length > 4000 ? `${text.slice(0, 4000)}…` : text}\n`);
  } catch {
    // Logging must never break the app.
  }
}
