import { createHash } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Writes sw.js with the build's file list, so the installed app opens offline
 * and a new deploy replaces the old cache as one version.
 */
function serviceWorker(): Plugin {
  return {
    name: 'offerdex-sw',
    apply: 'build',
    generateBundle(_, bundle) {
      const pub = (dir: string): string[] =>
        readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
          e.isDirectory() ? pub(path.join(dir, e.name)) : [path.relative('public', path.join(dir, e.name))],
        );
      // Map data is cached the first time the map opens, not on install.
      const lazy = pub('public').filter((f) => f.startsWith('geo/'));
      const files = ['/', ...Object.keys(bundle), ...pub('public').filter((f) => !lazy.includes(f))].map((f) => (f.startsWith('/') ? f : `/${f}`));
      const version = createHash('sha256').update(files.join('\n')).update(lazy.map((f) => `${f}:${statSync(path.join('public', f)).size}`).join('\n')).update(JSON.stringify(Object.values(bundle).map((b) => ('code' in b ? b.code.length : 0)))).digest('hex').slice(0, 12);
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: `// Generated at build time.
const CACHE = 'offerdex-${version}';
const FILES = ${JSON.stringify(files)};

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('offerdex-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Only this site's own files. Job boards, application forms and AI providers
// always go straight to the network.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // Fresh when online; the cached app shell when not. Static hosts answer
    // deep links with 404.html, which is the same app, so any HTML will do.
    e.respondWith(fetch(req).catch(() => caches.match('/', { cacheName: CACHE })));
    return;
  }
  e.respondWith(
    caches.match(req, { cacheName: CACHE }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && url.pathname.startsWith('/geo/')) {
            const copy = res.clone();
            void caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
`,
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: { port: 5173 },
});
