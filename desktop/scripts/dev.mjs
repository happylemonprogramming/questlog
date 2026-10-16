// One command for desktop development: start the web app's dev server, build
// the shell, open Electron on it, and stop everything when the window closes.
// Uses QUESTLOG_DEV_URL instead of starting a server when it's set.
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const root = path.dirname(desktop);

let server;
let url = process.env.QUESTLOG_DEV_URL;
if (!url) {
  // Tailwind and PostCSS resolve their config from the working directory.
  process.chdir(root);
  const { createServer } = await import(path.join(root, 'node_modules/vite/dist/node/index.js'));
  server = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), server: { port: 5173 } });
  await server.listen();
  url = server.resolvedUrls.local[0].replace(/\/$/, '');
  console.log(`Web app: ${url}`);
}

const build = spawnSync('npm', ['run', 'build:main'], { cwd: desktop, stdio: 'inherit' });
if (build.status) process.exit(build.status);

const electron = spawn(path.join(desktop, 'node_modules/.bin/electron'), ['.', ...process.argv.slice(2)], {
  cwd: desktop,
  stdio: 'inherit',
  env: { ...process.env, QUESTLOG_DEV_URL: url },
});
const stop = async (code) => {
  await server?.close();
  process.exit(code ?? 0);
};
electron.on('exit', stop);
process.on('SIGINT', () => electron.kill('SIGINT'));
process.on('SIGTERM', () => electron.kill('SIGTERM'));
