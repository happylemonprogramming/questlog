import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

/**
 * What the web app can ask of the desktop. Mirrored by DesktopBridge in
 * src/lib/desktop.ts, which is the side the app codes against.
 */

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

function on(channel: string, fn: (msg: any) => void) {
  const h = (_e: IpcRendererEvent, msg: unknown) => fn(msg);
  ipcRenderer.on(channel, h);
  return () => void ipcRenderer.off(channel, h);
}

if (process.argv.includes('--offerdex-test')) contextBridge.exposeInMainWorld('offerdexTest', { capture: (file: string) => invoke('test:capture', file) });

contextBridge.exposeInMainWorld('offerdexDesktop', {
  version: process.env.npm_package_version ?? '0.1.0',
  platform: process.platform,
  pdf: {
    make: (docId: string, fileName?: string) => invoke('pdf:make', docId, fileName),
    save: (docId: string, fileName?: string) => invoke('pdf:save', docId, fileName),
    reveal: (file: string) => invoke('pdf:reveal', file),
  },
  form: {
    status: () => invoke('form:status'),
    read: () => invoke('form:read'),
    fill: (fields: unknown) => invoke('form:fill', fields),
    click: (ref: string) => invoke('form:click', ref),
    text: () => invoke('form:text'),
    attach: (ref: string, docId: string, fileName?: string) => invoke('form:attach', ref, docId, fileName),
  },
  agent: {
    engines: () => invoke('agent:engines'),
    prompt: (req: unknown) => invoke('agent:prompt', req),
    cancel: (chatId: string) => invoke('agent:cancel', chatId),
    forget: (chatId: string) => invoke('agent:forget', chatId),
    answer: (id: string, optionId: string | null) => invoke('agent:permission', id, optionId),
    setOption: (chatId: string, configId: string, value: string) => invoke('agent:option', chatId, configId, value),
    onUpdate: (fn: (msg: unknown) => void) => on('agent:update', fn),
    onPermission: (fn: (msg: unknown) => void) => on('agent:permission', fn),
    onSession: (fn: (msg: unknown) => void) => on('agent:session', fn),
    onExit: (fn: (msg: unknown) => void) => on('agent:exit', fn),
  },
  /** Answer the external agent's tool requests with the app's own tools. */
  serveTools: (handler: { list: () => Promise<unknown>; call: (name: string, args: unknown) => Promise<unknown> }) =>
    on('tools:request', async ({ id, kind, payload }) => {
      let result: unknown;
      try {
        result = kind === 'list' ? await handler.list() : await handler.call(payload.name, payload.args);
      } catch (e) {
        result = { text: String((e as Error)?.message ?? e), isError: true };
      }
      ipcRenderer.send('tools:result', { id, result });
    }),
});
