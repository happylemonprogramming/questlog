import { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell, type WebContents } from 'electron';
import { existsSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Agents } from './agents';
import { Forms } from './forms';
import { loginPath } from './paths';
import { ToolBridge } from './bridge';
import { log, logDir } from './log';
import { legacyData, legacyTaken, useDataFolder } from './legacy';
import { LocalFolders } from './local';
import { Workspace, type WsFile } from './workspace';

/**
 * Questlog on the desktop: the same web app in a window, plus what a browser
 * tab can't do. It can fill in an application form on any site, attach a
 * real PDF of your resume, and run Claude Code, Codex or OpenCode as the
 * agent, with Questlog's own tools handed to it.
 */

const DEV_URL = process.env.QUESTLOG_DEV_URL;
const WEB = path.join(__dirname, '..', 'web');
const ORIGIN = DEV_URL ? new URL(DEV_URL).origin : 'app://questlog';
// Tests run with a throwaway profile and hidden windows.
if (process.env.QUESTLOG_PROFILE) app.setPath('userData', process.env.QUESTLOG_PROFILE);
else useDataFolder();
const HIDDEN = process.env.QUESTLOG_HIDDEN === '1';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

/**
 * The built web app, with every unknown path falling back to index.html for
 * the router. In development the app comes from the dev server, and app://
 * only serves the blank page the old name's data is read through.
 */
function serveApp(dev: boolean) {
  protocol.handle('app', (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname);
    if (rel === '/__blank') return new Response('<!doctype html><title></title>', { headers: { 'content-type': 'text/html' } });
    if (dev) return new Response('Not found', { status: 404 });
    let file = path.normalize(path.join(WEB, rel));
    if (!file.startsWith(WEB + path.sep) || !existsSync(file) || statSync(file).isDirectory()) file = path.join(WEB, 'index.html');
    return net.fetch(pathToFileURL(file).href);
  });
}

let win: BrowserWindow | null = null;
const bridge = new ToolBridge(() => win?.webContents);
const forms = new Forms();
const agents = new Agents(bridge, () => win?.webContents);
const workspace = new Workspace(() => win?.webContents);
const local = new LocalFolders();

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Questlog',
    backgroundColor: '#0b0d12',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      // The application form loads in a <webview>, which unlike an iframe works on any site.
      webviewTag: true,
      additionalArguments: HIDDEN ? ['--questlog-test'] : [],
      // Tests run hidden but measure real frames.
      backgroundThrottling: !HIDDEN,
    },
  });
  if (!HIDDEN) win.once('ready-to-show', () => win?.show());

  const wc = win.webContents;
  // Links leave the app for the browser; the app's own windows (print views) stay in.
  wc.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(ORIGIN)) return { action: 'allow' };
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN)) {
      e.preventDefault();
      void shell.openExternal(url);
    }
  });
  // The form's page gets nothing from Questlog: no preload, no Node.
  wc.on('will-attach-webview', (_e, prefs, params) => {
    delete prefs.preload;
    prefs.nodeIntegration = false;
    prefs.contextIsolation = true;
    prefs.sandbox = true;
    if (!/^https?:/.test(params.src)) params.src = 'about:blank';
  });
  wc.on('did-attach-webview', (_e, guest: WebContents) => {
    forms.watch(guest);
    // Sign-in pop-ups (Apply with LinkedIn, Google) need a real window.
    guest.setWindowOpenHandler(() => ({ action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true } }));
  });

  // A frozen or crashed page is the likeliest cause of "it just stopped"; keep a record.
  wc.on('render-process-gone', (_e, d) => log('window:gone', d));
  wc.on('unresponsive', () => log('window:unresponsive'));
  wc.on('responsive', () => log('window:responsive'));
  wc.on('console-message', (e) => {
    if (e.level === 'error') log('window:error', e.message.slice(0, 1000));
  });

  void win.loadURL(DEV_URL ?? `${ORIGIN}/`);
  win.on('closed', () => (win = null));
}

const slug = (s: string) => s.replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');

/** A document's print view in a hidden window, once its fonts have loaded. */
async function withRendered<T>(docId: string, fn: (page: BrowserWindow) => Promise<T>, offscreen = false): Promise<T> {
  // A hidden window never paints, so pictures need an offscreen one.
  const page = new BrowserWindow({ show: false, width: 816, height: 1056, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, offscreen } });
  try {
    await page.loadURL(`${ORIGIN}/print/${encodeURIComponent(docId)}?pdf=1`);
    const deadline = Date.now() + 20_000;
    for (;;) {
      const state = await page.webContents.executeJavaScript('window.__printReady ?? null');
      if (state === true) break;
      if (typeof state === 'string') throw new Error(state);
      if (Date.now() > deadline) throw new Error('The document took too long to render.');
      await new Promise((r) => setTimeout(r, 100));
    }
    return await fn(page);
  } finally {
    page.destroy();
  }
}

const printPdf = (page: BrowserWindow) =>
  page.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } });

/**
 * A document as a PDF, rendered by the same engine that shows it, so the file
 * matches the preview exactly and keeps real text for applicant tracking.
 */
async function makePdf(docId: string, fileName?: string): Promise<{ path: string; name: string }> {
  return withRendered(docId, async (page) => {
    const title = await page.webContents.executeJavaScript('document.title');
    const data = await printPdf(page);
    const name = `${slug(fileName || title || 'Document')}.pdf`;
    const dir = path.join(app.getPath('userData'), 'pdfs');
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, name);
    await writeFile(file, data);
    return { path: file, name };
  });
}

/**
 * What the agent sees when it checks its work: the page count of the real PDF,
 * and a picture of the document as printed, taller than one page when it spills.
 */
async function previewDoc(docId: string): Promise<{ pages: number; image: string; mimeType: string }> {
  return withRendered(docId, async (page) => {
    const pdf = await printPdf(page);
    const pages = pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g)?.length ?? 0;
    const wc = page.webContents;
    wc.debugger.attach();
    try {
      await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { media: 'print' });
      await new Promise((r) => setTimeout(r, 100));
      const height = Math.min(4 * 1056, Math.max(1056, await wc.executeJavaScript('document.documentElement.scrollHeight')));
      page.setContentSize(816, height);
      await new Promise((r) => setTimeout(r, 150));
      const shot = await wc.capturePage({ x: 0, y: 0, width: 816, height }, { stayHidden: true });
      return { pages, image: shot.toJPEG(85).toString('base64'), mimeType: 'image/jpeg' };
    } finally {
      wc.debugger.detach();
    }
  }, true);
}

/** Runs inside a company's page: its main colors, weighted by how much of the page they cover, and its typefaces. */
const BRAND_SCAN = `(() => {
  const hex = (c) => { const m = c.match(/rgba?\\(([\\d.]+), ([\\d.]+), ([\\d.]+)(?:, ([\\d.]+))?\\)/); if (!m || (m[4] !== undefined && +m[4] < 0.5)) return null; return '#' + [m[1], m[2], m[3]].map((x) => Math.round(+x).toString(16).padStart(2, '0')).join(''); };
  const bg = new Map(), fg = new Map(), accents = new Map(), fonts = new Map();
  const add = (map, k, w) => k && map.set(k, (map.get(k) || 0) + w);
  const els = [...document.querySelectorAll('body *')].slice(0, 4000);
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.top > innerHeight * 3) continue;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity === 0) continue;
    const area = Math.min(r.width * r.height, innerWidth * innerHeight);
    add(bg, hex(s.backgroundColor), area);
    const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('').length;
    if (text) {
      add(fg, hex(s.color), text);
      const fam = s.fontFamily.split(',')[0].replace(/["']/g, '').trim();
      const role = /^H[1-3]$/.test(el.tagName) || parseFloat(s.fontSize) >= 28 ? 'headings' : 'text';
      add(fonts, role + ': ' + fam, text);
    }
    if (el.matches('a, button, [role=button]') && r.width < 500) add(accents, hex(s.backgroundColor) || hex(s.color), area);
  }
  const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
  return {
    title: document.title,
    url: location.href,
    themeColor: document.querySelector('meta[name=theme-color]')?.content || null,
    backgrounds: top(bg, 6), text: top(fg, 5), accents: top(accents, 6), fonts: top(fonts, 6),
    height: document.documentElement.scrollHeight,
  };
})()`;

/**
 * A company's website as a person would see it, for designing a resume that
 * fits the company: two screenshots plus the colors and type it uses. The page
 * runs in its own throwaway session with no access to Questlog.
 */
async function viewSite(url: string) {
  if (!/^https?:\/\//i.test(url)) throw new Error('Give a full http(s) URL.');
  const page = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, partition: 'sites', javascript: true } });
  const wc = page.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.session.on('will-download', (e) => e.preventDefault());
  wc.setAudioMuted(true);
  try {
    await Promise.race([wc.loadURL(url).catch(() => {}), new Promise((r) => setTimeout(r, 25_000))]);
    // Let client-side apps draw and fonts arrive.
    await new Promise((r) => setTimeout(r, 2500));
    const brand = await wc.executeJavaScript(BRAND_SCAN);
    const shot = async () => (await wc.capturePage()).resize({ width: 1024 }).toJPEG(75).toString('base64');
    const images = [await shot()];
    if (brand.height > 1300) {
      await wc.executeJavaScript('window.scrollTo(0, Math.min(innerHeight * 1.5, document.documentElement.scrollHeight - innerHeight))');
      await new Promise((r) => setTimeout(r, 1200));
      images.push(await shot());
    }
    return { ...brand, images, mimeType: 'image/jpeg' };
  } finally {
    page.destroy();
  }
}

/**
 * A picture from the web, for the image library: a logo, a headshot. Fetched
 * here, where pages' cross-origin rules don't apply, in the same throwaway
 * session as viewSite, so it carries no cookies of the user's.
 */
async function fetchImage(url: string): Promise<{ type: string; base64: string; url: string }> {
  if (!/^https?:\/\//i.test(url)) throw new Error('Give a full http(s) URL.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await session.fromPartition('sites').fetch(url, { signal: ctrl.signal, headers: { accept: 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8' } });
    if (!res.ok) throw new Error(`The server said ${res.status} ${res.statusText}.`);
    let type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 10 * 1024 * 1024) throw new Error('That image is over 10 MB.');
    // Some servers send images as octet-stream; go by the bytes.
    if (!type.startsWith('image/')) {
      const head = buf.subarray(0, 512).toString('latin1');
      type = buf[0] === 0x89 && head.startsWith('PNG', 1) ? 'image/png'
        : buf[0] === 0xff && buf[1] === 0xd8 ? 'image/jpeg'
        : head.startsWith('GIF8') ? 'image/gif'
        : head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP' ? 'image/webp'
        : /<svg[\s>]/i.test(buf.subarray(0, 4096).toString('utf8')) ? 'image/svg+xml'
        : '';
      if (!type) throw new Error(`That address isn't an image (it's ${res.headers.get('content-type') || 'unknown'}). Find the image's own URL.`);
    }
    return { type, base64: buf.toString('base64'), url: res.url };
  } finally {
    clearTimeout(timer);
  }
}

function handle(channel: string, fn: (...args: any[]) => unknown) {
  ipcMain.handle(channel, async (_e, ...args) => fn(...args));
}

handle('pdf:make', (docId: string, fileName?: string) => makePdf(docId, fileName));
handle('pdf:preview', (docId: string) => previewDoc(docId));
handle('pdf:save', async (docId: string, fileName?: string) => {
  const made = await makePdf(docId, fileName);
  const res = await dialog.showSaveDialog(win!, { defaultPath: path.join(app.getPath('downloads'), made.name), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (res.canceled || !res.filePath) return null;
  const { copyFile } = await import('node:fs/promises');
  await copyFile(made.path, res.filePath);
  return res.filePath;
});
handle('pdf:reveal', (file: string) => shell.showItemInFolder(file));
handle('logs:open', () => shell.openPath(logDir()));
handle('legacy:data', () => legacyData());
handle('ws:info', () => workspace.info());
handle('ws:choose', () => workspace.choose(win));
handle('ws:useDefault', () => workspace.open(workspace.defaultRoot()));
handle('ws:reveal', () => workspace.reveal());
handle('ws:readAll', () => workspace.readAll());
handle('ws:read', (paths: string[]) => workspace.read(paths));
handle('ws:write', (files: WsFile[], message: string) => workspace.write(files, message));
handle('ws:remove', (paths: string[], message: string) => workspace.remove(paths, message));
handle('history:list', () => workspace.history.list());
handle('history:restore', (oid: string) => workspace.history.restore(oid));
handle('history:undo', () => workspace.history.undo());
handle('history:clear', () => workspace.history.clear());
handle('legacy:taken', () => legacyTaken());
handle('site:view', (url: string) => viewSite(url));
handle('image:fetch', (url: string) => fetchImage(url));

handle('local:grant', () => local.grant(win));
handle('local:grants', () => local.grants());
handle('local:revoke', (folder: string) => local.revoke(folder));
handle('local:list', (p?: string, depth?: number) => local.list(p, depth));
handle('local:read', (p: string, offset?: number, limit?: number) => local.read(p, offset, limit));
handle('local:readImage', (p: string) => local.readImage(p));
handle('local:search', (query: string, p?: string) => local.search(query, p));
handle('local:git', (p?: string, opts?: { emails?: string[] }) => local.gitHistory(p, opts));

handle('form:status', () => forms.status());
handle('form:read', () => forms.read());
handle('form:fill', (fields: { ref: string; value: unknown }[]) => forms.fill(fields));
handle('form:click', (ref: string) => forms.click(ref));
handle('form:text', () => forms.text());
// The user's own Submit press. The agent's tools never call this.
handle('form:submit', () => forms.submit());
handle('form:attach', async (ref: string, docId: string, fileName?: string) => {
  const pdf = await makePdf(docId, fileName);
  return forms.attach(ref, pdf.path);
});

handle('agent:engines', () => agents.engines());
handle('agent:prompt', (req) => agents.prompt(req));
handle('agent:cancel', (chatId: string) => agents.cancel(chatId));
handle('agent:forget', (chatId: string) => agents.forget(chatId));
handle('agent:permission', (id: string, optionId: string | null) => agents.answer(id, optionId));
handle('agent:option', (chatId: string, configId: string, value: string) => agents.setOption(chatId, configId, value));

ipcMain.on('tools:result', (_e, msg) => bridge.resolve(msg));

// Tests take screenshots of the hidden window from here; the page can't capture its own webview.
if (HIDDEN) handle('test:capture', async (file: string) => writeFile(file, (await win!.webContents.capturePage(undefined, { stayHidden: true })).toPNG()));

process.on('uncaughtException', (e) => log('main:exception', e.stack ?? String(e)));
process.on('unhandledRejection', (e) => log('main:rejection', (e as Error)?.stack ?? String(e)));

app.whenReady().then(async () => {
  log('app:start', { version: app.getVersion(), dev: !!DEV_URL });
  // Apps opened from a dock or launcher don't get the shell's PATH, which is
  // where claude, codex and opencode usually live.
  process.env.PATH = await loginPath();
  serveApp(!!DEV_URL);
  await bridge.start();
  await workspace.start();
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => {
  agents.stopAll();
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => agents.stopAll());
