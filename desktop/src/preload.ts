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

if (process.argv.includes('--questlog-test')) contextBridge.exposeInMainWorld('questlogTest', { capture: (file: string) => invoke('test:capture', file) });

contextBridge.exposeInMainWorld('questlogDesktop', {
  version: process.env.npm_package_version ?? '0.1.0',
  platform: process.platform,
  openLogs: () => invoke('logs:open'),
  workspace: {
    info: () => invoke('ws:info'),
    choose: () => invoke('ws:choose'),
    useDefault: () => invoke('ws:useDefault'),
    reveal: () => invoke('ws:reveal'),
    readAll: () => invoke('ws:readAll'),
    read: (paths: string[]) => invoke('ws:read', paths),
    write: (files: unknown, message: string) => invoke('ws:write', files, message),
    remove: (paths: string[], message: string) => invoke('ws:remove', paths, message),
    onChanged: (fn: (msg: unknown) => void) => on('ws:changed', fn),
  },
  history: {
    list: () => invoke('history:list'),
    restore: (oid: string) => invoke('history:restore', oid),
    undo: () => invoke('history:undo'),
    clear: () => invoke('history:clear'),
  },
  legacy: {
    data: () => invoke('legacy:data'),
    taken: () => invoke('legacy:taken'),
  },
  viewSite: (url: string) => invoke('site:view', url),
  fetchImage: (url: string) => invoke('image:fetch', url),
  local: {
    grant: () => invoke('local:grant'),
    grants: () => invoke('local:grants'),
    revoke: (folder: string) => invoke('local:revoke', folder),
    list: (p?: string, depth?: number) => invoke('local:list', p, depth),
    read: (p: string, offset?: number, limit?: number) => invoke('local:read', p, offset, limit),
    readImage: (p: string) => invoke('local:readImage', p),
    search: (query: string, p?: string) => invoke('local:search', query, p),
    git: (p?: string, opts?: { emails?: string[] }) => invoke('local:git', p, opts),
  },
  pdf: {
    make: (docId: string, fileName?: string) => invoke('pdf:make', docId, fileName),
    save: (docId: string, fileName?: string) => invoke('pdf:save', docId, fileName),
    reveal: (file: string) => invoke('pdf:reveal', file),
    preview: (docId: string) => invoke('pdf:preview', docId),
  },
  form: {
    status: () => invoke('form:status'),
    read: () => invoke('form:read'),
    fill: (fields: unknown) => invoke('form:fill', fields),
    click: (ref: string) => invoke('form:click', ref),
    text: () => invoke('form:text'),
    submit: () => invoke('form:submit'),
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
