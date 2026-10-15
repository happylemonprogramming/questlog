import { randomBytes, randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { WebContents } from 'electron';
import { log } from './log';

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: unknown;
}

export interface ToolOutcome {
  text: string;
  isError?: boolean;
  /** Base64 pictures for the agent to look at, e.g. a rendered page. */
  images?: { data: string; mimeType: string }[];
}

/**
 * Offerdex's tools live in the window, next to the data they read and write.
 * An external agent reaches them through a small MCP server it launches
 * (mcp-bridge), which calls back here over localhost with a secret token, and
 * each call is run by the window.
 */
export class ToolBridge {
  url = '';
  readonly token = randomBytes(24).toString('hex');
  private pending = new Map<string, (r: unknown) => void>();

  constructor(private window: () => WebContents | undefined) {}

  async start() {
    const server = http.createServer((req, res) => {
      if (req.method !== 'POST' || req.headers.authorization !== `Bearer ${this.token}`) {
        res.writeHead(403).end();
        return;
      }
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          const msg = JSON.parse(body || '{}');
          const out = req.url === '/list' ? await this.list() : await this.call(msg.name, msg.args);
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
        } catch (e) {
          res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ text: String((e as Error).message ?? e), isError: true }));
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  private ask(kind: 'list' | 'call', payload: unknown, timeoutMs: number): Promise<unknown> {
    const wc = this.window();
    if (!wc) return Promise.reject(new Error('The Offerdex window is closed.'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Offerdex did not answer in time.'));
      }, timeoutMs);
      this.pending.set(id, (r) => {
        clearTimeout(t);
        resolve(r);
      });
      wc.send('tools:request', { id, kind, payload });
    });
  }

  list() {
    return this.ask('list', null, 15_000) as Promise<ToolSpec[]>;
  }

  async call(name: string, args: unknown) {
    const started = Date.now();
    try {
      const out = (await this.ask('call', { name, args }, 180_000)) as ToolOutcome;
      log('offerdex-tool', { name, ms: Date.now() - started, error: out.isError ? out.text.slice(0, 300) : undefined });
      return out;
    } catch (e) {
      log('offerdex-tool:failed', { name, ms: Date.now() - started, error: (e as Error).message });
      throw e;
    }
  }

  /** The window's answer to a request. */
  resolve(msg: { id: string; result: unknown }) {
    this.pending.get(msg.id)?.(msg.result);
    this.pending.delete(msg.id);
  }
}
