// One command for desktop development: start the web app's dev server, build
// the shell, open Electron on it, and stop everything when the window closes.
// Uses QUESTLOG_DEV_URL instead of starting a server when it's set.
//
// With --fast, it builds the web app for production and serves that instead:
// no hot reload, but React's production build, so it runs at full speed. It
// uses the same address as the dev server, so it sees the same chats and
// settings.
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const root = path.dirname(desktop);
const fast = process.argv.includes('--fast');
const args = process.argv.slice(2).filter((a) => a !== '--fast');

let server;
let url = process.env.QUESTLOG_DEV_URL;
if (!url) {
  // Tailwind and PostCSS resolve their config from the working directory.
  process.chdir(root);
  const vite = await import(path.join(root, 'node_modules/vite/dist/node/index.js'));
  const configFile = path.join(root, 'vite.config.ts');
  if (fast) {
    const web = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
    if (web.status) process.exit(web.status);
    // The same port as the dev server, so the app keeps its chats and settings.
    server = await vite.preview({ root, configFile, preview: { port: 5173, strictPort: true } });
  } else {
    server = await vite.createServer({ root, configFile, server: { port: 5173 } });
    await server.listen();
  }
  url = server.resolvedUrls.local[0].replace(/\/$/, '');
  console.log(`Web app: ${url}${fast ? ' (production build)' : ''}`);
}

const build = spawnSync('npm', ['run', 'build:main'], { cwd: desktop, stdio: 'inherit' });
if (build.status) process.exit(build.status);

const electron = spawn(path.join(desktop, 'node_modules/.bin/electron'), ['.', ...args], {
  cwd: desktop,
  stdio: 'inherit',
  env: { ...process.env, QUESTLOG_DEV_URL: url },
});
const stop = async (code) => {
  await (server?.close ? server.close() : new Promise((r) => server?.httpServer?.close(r)));
  process.exit(code ?? 0);
};
electron.on('exit', stop);
process.on('SIGINT', () => electron.kill('SIGINT'));
process.on('SIGTERM', () => electron.kill('SIGTERM'));
