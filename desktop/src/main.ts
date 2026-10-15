import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell, type WebContents } from 'electron';
import { existsSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Agents } from './agents';
import { Forms } from './forms';
import { loginPath } from './paths';
import { ToolBridge } from './bridge';

/**
 * Offerdex on the desktop: the same web app in a window, plus what a browser
 * tab can't do. It can fill in an application form on any site, attach a
 * real PDF of your resume, and run Claude Code, Codex or OpenCode as the
 * agent, with Offerdex's own tools handed to it.
 */

const DEV_URL = process.env.OFFERDEX_DEV_URL;
const WEB = path.join(__dirname, '..', 'web');
const ORIGIN = DEV_URL ? new URL(DEV_URL).origin : 'app://offerdex';
// Tests run with a throwaway profile and hidden windows.
if (process.env.OFFERDEX_PROFILE) app.setPath('userData', process.env.OFFERDEX_PROFILE);
const HIDDEN = process.env.OFFERDEX_HIDDEN === '1';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

/** The built web app, with every unknown path falling back to index.html for the router. */
function serveApp() {
  protocol.handle('app', (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname);
    let file = path.normalize(path.join(WEB, rel));
    if (!file.startsWith(WEB) || !existsSync(file) || statSync(file).isDirectory()) file = path.join(WEB, 'index.html');
    return net.fetch(pathToFileURL(file).href);
  });
}

let win: BrowserWindow | null = null;
const bridge = new ToolBridge(() => win?.webContents);
const forms = new Forms();
const agents = new Agents(bridge, () => win?.webContents);

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Offerdex',
    backgroundColor: '#0b0d12',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      // The application form loads in a <webview>, which unlike an iframe works on any site.
      webviewTag: true,
      additionalArguments: HIDDEN ? ['--offerdex-test'] : [],
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
  // The form's page gets nothing from Offerdex: no preload, no Node.
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

  void win.loadURL(DEV_URL ?? `${ORIGIN}/`);
  win.on('closed', () => (win = null));
}

const slug = (s: string) => s.replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');

/**
 * A document as a PDF, rendered by the same engine that shows it, so the file
 * matches the preview exactly and keeps real text for applicant tracking.
 */
async function makePdf(docId: string, fileName?: string): Promise<{ path: string; name: string }> {
  const page = new BrowserWindow({ show: false, width: 816, height: 1056, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true } });
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
    const title = await page.webContents.executeJavaScript('document.title');
    const data = await page.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } });
    const name = `${slug(fileName || title || 'Document')}.pdf`;
    const dir = path.join(app.getPath('userData'), 'pdfs');
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, name);
    await writeFile(file, data);
    return { path: file, name };
  } finally {
    page.destroy();
  }
}

function handle(channel: string, fn: (...args: any[]) => unknown) {
  ipcMain.handle(channel, async (_e, ...args) => fn(...args));
}

handle('pdf:make', (docId: string, fileName?: string) => makePdf(docId, fileName));
handle('pdf:save', async (docId: string, fileName?: string) => {
  const made = await makePdf(docId, fileName);
  const res = await dialog.showSaveDialog(win!, { defaultPath: path.join(app.getPath('downloads'), made.name), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (res.canceled || !res.filePath) return null;
  const { copyFile } = await import('node:fs/promises');
  await copyFile(made.path, res.filePath);
  return res.filePath;
});
handle('pdf:reveal', (file: string) => shell.showItemInFolder(file));

handle('form:status', () => forms.status());
handle('form:read', () => forms.read());
handle('form:fill', (fields: { ref: string; value: unknown }[]) => forms.fill(fields));
handle('form:click', (ref: string) => forms.click(ref));
handle('form:text', () => forms.text());
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

app.whenReady().then(async () => {
  // Apps opened from a dock or launcher don't get the shell's PATH, which is
  // where claude, codex and opencode usually live.
  process.env.PATH = await loginPath();
  if (!DEV_URL) serveApp();
  await bridge.start();
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => {
  agents.stopAll();
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => agents.stopAll());
