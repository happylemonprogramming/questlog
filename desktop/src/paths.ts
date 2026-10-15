import { execFile } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = os.homedir();

/** Where command-line tools usually end up, beyond whatever PATH the app was started with. */
const COMMON = [
  path.join(home, '.local/bin'),
  path.join(home, '.local/share/mise/shims'),
  path.join(home, '.asdf/shims'),
  path.join(home, '.volta/bin'),
  path.join(home, '.bun/bin'),
  path.join(home, '.opencode/bin'),
  path.join(home, '.claude/local'),
  path.join(home, '.npm-global/bin'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
];

/** PATH as a login shell sees it, merged with the app's own and the usual install folders. */
export async function loginPath(): Promise<string> {
  const own = (process.env.PATH ?? '').split(path.delimiter);
  let shellPath: string[] = [];
  if (process.platform !== 'win32') {
    const sh = process.env.SHELL || '/bin/sh';
    shellPath = await new Promise<string[]>((resolve) => {
      execFile(sh, ['-ilc', 'printf "__P__%s__P__" "$PATH"'], { timeout: 4000 }, (_err, out) => {
        resolve(out?.match(/__P__(.*)__P__/)?.[1]?.split(':') ?? []);
      });
    });
  }
  return [...new Set([...own, ...shellPath, ...COMMON].filter(Boolean))].join(path.delimiter);
}

/** The full path of a command on PATH, or null. */
export function which(cmd: string): string | null {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    for (const ext of exts) {
      const p = path.join(dir, cmd + ext);
      try {
        accessSync(p, constants.X_OK);
        return p;
      } catch {
        // keep looking
      }
    }
  }
  return null;
}
