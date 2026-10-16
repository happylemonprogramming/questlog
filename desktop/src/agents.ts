import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION, type Agent, type Client } from '@agentclientprotocol/sdk';
import type * as acp from '@agentclientprotocol/sdk';
import { app, type WebContents } from 'electron';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import type { ToolBridge } from './bridge';
import { log } from './log';
import { which } from './paths';

/**
 * Coding agents as Offerdex's agent, over the Agent Client Protocol. Each
 * engine runs as a child process; each Offerdex chat is one session in it.
 * Offerdex's tools reach the agent as an MCP server (mcp-bridge), so Claude
 * Code or Codex work the app exactly as the built-in agent does.
 */

export type EngineId = 'claude' | 'codex' | 'opencode' | 'goose';

interface EngineDef {
  id: EngineId;
  label: string;
  /** How to start it, or why it can't start. */
  launch(): { command: string; args: string[]; env?: Record<string, string> } | { missing: string };
  /** Shown under the name in the picker. */
  note: string;
  /** A command that exits 0 when the engine is logged in, and what to tell the user when it isn't. */
  login?: { command: string; args: string[]; hint: string };
}

/** Whether a login check passes. No check, or no CLI to check with, counts as unknown. */
function loggedIn(login: EngineDef['login']): Promise<boolean | undefined> {
  if (!login) return Promise.resolve(undefined);
  const bin = which(login.command);
  if (!bin) return Promise.resolve(undefined);
  return new Promise((resolve) => execFile(bin, login.args, { timeout: 8000 }, (err) => resolve(!err)));
}

/**
 * The Claude Code binary the adapter drives. The adapter can bring its own,
 * but it's hundreds of megabytes, so the packaged app ships without it and
 * uses the one you installed. In development the bundled copy is preferred,
 * since it's the version the adapter was built against.
 */
function claudeExe(): string | undefined {
  try {
    return require.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude${process.platform === 'win32' ? '.exe' : ''}`);
  } catch {
    return which('claude') ?? undefined;
  }
}

/** A script from an npm package, run with Node: the system's if there is one, else Electron's own. */
function nodeScript(pkg: string, file: string, env: Record<string, string> = {}) {
  let script: string;
  try {
    script = require.resolve(`${pkg}/${file}`).replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  } catch {
    return { missing: `${pkg} isn't installed` };
  }
  const node = which('node');
  return node ? { command: node, args: [script], env } : { command: process.execPath, args: [script], env: { ...env, ELECTRON_RUN_AS_NODE: '1' } };
}

const ENGINES: EngineDef[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    note: 'Uses your Claude subscription or API key.',
    login: { command: 'claude', args: ['auth', 'status'], hint: 'run `claude` in a terminal and log in' },
    launch: () => {
      const exe = claudeExe();
      if (!exe) return { missing: 'Claude Code is not installed (see claude.ai/install)' };
      return nodeScript('@agentclientprotocol/claude-agent-acp', 'dist/index.js', { CLAUDE_CODE_EXECUTABLE: exe });
    },
  },
  {
    id: 'codex',
    label: 'Codex',
    note: 'Uses your ChatGPT plan or OpenAI key.',
    login: { command: 'codex', args: ['login', 'status'], hint: 'run `codex login` in a terminal' },
    launch: () => {
      // The Codex you installed; the packaged app doesn't carry its own.
      const exe = which('codex');
      if (!exe) return { missing: 'Codex is not installed (npm i -g @openai/codex)' };
      return nodeScript('@agentclientprotocol/codex-acp', 'dist/index.js', { CODEX_PATH: exe });
    },
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    note: 'Any model OpenCode is set up for, including its free ones. Free models may log what you send.',
    launch: () => {
      const bin = which('opencode');
      return bin ? { command: bin, args: ['acp'] } : { missing: 'opencode is not on your PATH (install it from opencode.ai)' };
    },
  },
  {
    id: 'goose',
    label: 'Goose',
    note: 'Any model Goose is set up for.',
    launch: () => {
      const bin = which('goose');
      return bin ? { command: bin, args: ['acp'] } : { missing: 'goose is not on your PATH' };
    },
  },
];

/**
 * The environment engines start with. A shell that routes Anthropic calls
 * through a local proxy (ANTHROPIC_BASE_URL=http://127.0.0.1:…, as Meridian
 * setups do) would send Claude Code there instead of to the login it has, so
 * those settings are left out. A real API endpoint and key are kept.
 */
function agentEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (/^https?:\/\/(localhost|127\.|\[?::1\]?)/i.test(env.ANTHROPIC_BASE_URL ?? '')) {
    delete env.ANTHROPIC_BASE_URL;
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
  }
  return env;
}

/**
 * Whether a tool call is one of Offerdex's own tools, by the exact name each
 * engine gives an MCP tool: Claude Code "mcp__offerdex__save_job", Codex
 * "mcp.offerdex.save_job", OpenCode "offerdex_save_job". The whole name has to
 * match, so a shell command that merely mentions offerdex (the agent's folder
 * is under it) doesn't pass.
 */
const OUR_TOOL = /^(mcp__offerdex__|mcp\.offerdex\.|offerdex[_.\/:]|offerdex__)[a-z][a-z_]*$/i;

function isOurs(tc: acp.ToolCallUpdate, earlier?: { title?: string | null }): boolean {
  const meta = (tc._meta as { claudeCode?: { toolName?: string; mcpServer?: { name?: string } } } | undefined)?.claudeCode;
  if (meta?.mcpServer) return meta.mcpServer.name === 'offerdex';
  if (meta?.toolName) return OUR_TOOL.test(meta.toolName);
  // Codex asks about an MCP call by id alone; its name came in the call's first update.
  return [tc.title, earlier?.title].some((t) => !!t && OUR_TOOL.test(t.trim()));
}

/**
 * Tools that only read the web run without asking. Reading files on this
 * computer, running commands and editing files always ask.
 */
const WEB_ONLY = new Set(['search', 'fetch', 'think']);

export interface PromptRequest {
  chatId: string;
  engine: EngineId;
  text: string;
  /** Offerdex's instructions: the profile, rules and how to work. Sent when a session starts. */
  system: string;
  /** Preferred config choices, e.g. { model: 'opus' }, applied when a session starts. */
  options?: Record<string, string>;
}

interface Running {
  engine: EngineId;
  proc: ChildProcess;
  conn: ClientSideConnection;
  init: acp.InitializeResponse;
  stderr: string[];
}

interface Session {
  engine: EngineId;
  id: string;
  configOptions: acp.SessionConfigOption[];
  /** The system prompt still has to go out with the first message. */
  primed: boolean;
}

export class Agents {
  private running = new Map<EngineId, Promise<Running>>();
  private sessions = new Map<string, Session>();
  private chatOf = new Map<string, string>();
  private asks = new Map<string, (optionId: string | null) => void>();
  /** When each session last sent an update, so a turn isn't closed while its last words are in flight. */
  private lastUpdate = new Map<string, number>();
  /** Each tool call's title as first reported, for permission requests that arrive without one. */
  private callTitles = new Map<string, string>();
  private workdir: string;

  constructor(private bridge: ToolBridge, private window: () => WebContents | undefined) {
    // Agents get an empty folder of their own, never your files.
    this.workdir = path.join(app.getPath('userData'), 'agent');
    mkdirSync(this.workdir, { recursive: true });
  }

  engines() {
    return Promise.all(
      ENGINES.map(async (e) => {
        const l = e.launch();
        const available = !('missing' in l);
        const ok = available ? await loggedIn(e.login) : undefined;
        return { id: e.id, label: e.label, note: e.note, available, missing: 'missing' in l ? l.missing : undefined, login: ok === false ? e.login!.hint : undefined };
      }),
    );
  }

  private send(channel: string, msg: unknown) {
    this.window()?.send(channel, msg);
  }

  private start(engine: EngineId): Promise<Running> {
    const have = this.running.get(engine);
    if (have) return have;
    const p = this.spawn(engine);
    this.running.set(engine, p);
    p.catch(() => this.running.delete(engine));
    return p;
  }

  private async spawn(engine: EngineId): Promise<Running> {
    const def = ENGINES.find((e) => e.id === engine)!;
    const l = def.launch();
    if ('missing' in l) throw new Error(`${def.label} can't start: ${l.missing}.`);
    log('engine:start', { engine, command: l.command });
    const proc = spawn(l.command, l.args, { cwd: this.workdir, env: { ...agentEnv(), ...l.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    const stderr: string[] = [];
    proc.stderr!.on('data', (d) => {
      stderr.push(String(d));
      if (stderr.length > 40) stderr.shift();
    });
    proc.on('exit', (code, signal) => {
      log('engine:exit', { engine, code, signal, stderr: code ? stderr.join('').slice(-2000) : undefined });
      this.running.delete(engine);
      for (const [key, s] of this.sessions) if (s.engine === engine) this.sessions.delete(key);
      if (code) this.send('agent:exit', { engine, code, stderr: stderr.join('').slice(-2000) });
    });
    const stream = ndJsonStream(Writable.toWeb(proc.stdin!) as WritableStream<Uint8Array>, Readable.toWeb(proc.stdout!) as ReadableStream<Uint8Array>);
    const conn = new ClientSideConnection((_agent: Agent) => this.client(), stream);
    const init = await Promise.race([
      conn.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: 'offerdex', version: app.getVersion() } }),
      new Promise<never>((_, rej) => proc.once('exit', () => rej(new Error(`${def.label} quit while starting. ${stderr.join('').slice(-600)}`)))),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${def.label} didn't respond.`)), 60_000)),
    ]);
    return { engine, proc, conn, init, stderr };
  }

  private client(): Client {
    return {
      sessionUpdate: async (n) => {
        this.lastUpdate.set(n.sessionId, Date.now());
        const chatId = this.chatOf.get(n.sessionId);
        const u = n.update as { sessionUpdate: string; toolCallId?: string; title?: string; kind?: string; status?: string };
        if (u.toolCallId && u.title && !this.callTitles.has(u.toolCallId)) {
          this.callTitles.set(u.toolCallId, u.title);
          if (this.callTitles.size > 500) this.callTitles.delete(this.callTitles.keys().next().value!);
        }
        if (u.status === 'completed' || u.status === 'failed') log('tool', { chatId, title: u.title, kind: u.kind, status: u.status });
        if (chatId) this.send('agent:update', { chatId, update: n.update });
      },
      requestPermission: async (req) => {
        const chatId = this.chatOf.get(req.sessionId);
        const allow = req.options.find((o) => o.kind === 'allow_once') ?? req.options.find((o) => o.kind === 'allow_always');
        const tc = req.toolCall;
        // Offerdex's own tools are what the agent is for, and reading the web
        // changes nothing; both run without asking.
        const ours = isOurs(tc, { title: this.callTitles.get(tc.toolCallId) });
        if (allow && (ours || WEB_ONLY.has(tc.kind ?? ''))) {
          if (!ours) log('permission:auto', { chatId, title: tc.title, kind: tc.kind });
          return { outcome: { outcome: 'selected', optionId: allow.optionId } };
        }
        if (!chatId) return { outcome: { outcome: 'cancelled' } };
        const id = randomUUID();
        log('permission:ask', { chatId, title: tc.title, kind: tc.kind });
        const choice = await new Promise<string | null>((resolve) => {
          this.asks.set(id, resolve);
          this.send('agent:permission', { id, chatId, title: tc.title, kind: tc.kind, input: tc.rawInput, options: req.options });
        });
        this.asks.delete(id);
        log('permission:answer', { chatId, choice });
        return choice ? { outcome: { outcome: 'selected', optionId: choice } } : { outcome: { outcome: 'cancelled' } };
      },
    };
  }

  answer(id: string, optionId: string | null) {
    this.asks.get(id)?.(optionId);
  }

  private mcpServer(): acp.McpServerStdio {
    const bridge = path.join(__dirname, 'mcp-bridge.cjs').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
    const node = which('node');
    return {
      name: 'offerdex',
      command: node ?? process.execPath,
      args: [bridge],
      env: [
        ...(node ? [] : [{ name: 'ELECTRON_RUN_AS_NODE', value: '1' }]),
        { name: 'OFFERDEX_BRIDGE_URL', value: this.bridge.url },
        { name: 'OFFERDEX_BRIDGE_TOKEN', value: this.bridge.token },
      ],
    };
  }

  private async session(req: PromptRequest): Promise<{ run: Running; s: Session }> {
    const run = await this.start(req.engine);
    let s = this.sessions.get(req.chatId);
    if (s && s.engine === req.engine) return { run, s };
    const res = await run.conn.newSession({
      cwd: this.workdir,
      mcpServers: [this.mcpServer()],
      _meta: {
        // Claude Code: add Offerdex's instructions to its own, and keep only
        // its web tools. It works through Offerdex's tools, not a shell.
        systemPrompt: { append: req.system },
        claudeCode: { options: { tools: ['WebSearch', 'WebFetch'] } },
      },
    });
    s = { engine: req.engine, id: res.sessionId, configOptions: res.configOptions ?? [], primed: req.engine === 'claude' };
    this.sessions.set(req.chatId, s);
    this.chatOf.set(s.id, req.chatId);
    for (const [configId, value] of Object.entries(req.options ?? {})) {
      const opt = s.configOptions.find((o) => o.id === configId);
      if (opt && opt.type === 'select' && opt.currentValue !== value) {
        try {
          const r = await run.conn.setSessionConfigOption({ sessionId: s.id, configId, value });
          s.configOptions = r.configOptions ?? s.configOptions;
        } catch {
          // An option the engine no longer offers; keep its default.
        }
      }
    }
    this.send('agent:session', { chatId: req.chatId, engine: req.engine, configOptions: s.configOptions });
    return { run, s };
  }

  async prompt(req: PromptRequest) {
    const started = Date.now();
    log('prompt:start', { chatId: req.chatId, engine: req.engine, text: req.text.slice(0, 300) });
    try {
      const { run, s } = await this.session(req);
      // Engines without a system prompt option get Offerdex's instructions up front.
      const text = s.primed ? req.text : `<offerdex_instructions>\n${req.system}\n</offerdex_instructions>\n\n${req.text}`;
      s.primed = true;
      const res = await run.conn.prompt({ sessionId: s.id, prompt: [{ type: 'text', text }] });
      await this.settle(s.id);
      log('prompt:end', { chatId: req.chatId, stopReason: res.stopReason, seconds: Math.round((Date.now() - started) / 1000) });
      return { stopReason: res.stopReason };
    } catch (e) {
      const err = e as { message?: string; data?: unknown; code?: number };
      const detail = typeof err.data === 'object' && err.data ? JSON.stringify(err.data) : '';
      log('prompt:error', { chatId: req.chatId, error: err.message ?? String(e), detail, seconds: Math.round((Date.now() - started) / 1000) });
      return { error: `${err.message ?? String(e)}${detail ? ` ${detail}` : ''}`, auth: err.code === -32000 };
    }
  }

  /**
   * The answer to a prompt can arrive before the last few updates of the
   * reply have been handed on, which used to cut the final sentence off.
   * Wait until the session has been quiet briefly.
   */
  private async settle(sessionId: string) {
    const until = Date.now() + 3000;
    while (Date.now() < until && Date.now() - (this.lastUpdate.get(sessionId) ?? 0) < 250) await new Promise((r) => setTimeout(r, 50));
  }

  async cancel(chatId: string) {
    const s = this.sessions.get(chatId);
    log('prompt:cancel', { chatId });
    if (!s) return;
    for (const [id, resolve] of this.asks) {
      resolve(null);
      this.asks.delete(id);
    }
    const run = await this.running.get(s.engine);
    await run?.conn.cancel({ sessionId: s.id });
  }

  /** Drop a chat's session, e.g. after switching engines; the next message starts a new one. */
  forget(chatId: string) {
    const s = this.sessions.get(chatId);
    if (s) this.chatOf.delete(s.id);
    this.sessions.delete(chatId);
  }

  async setOption(chatId: string, configId: string, value: string) {
    const s = this.sessions.get(chatId);
    if (!s) return null;
    const run = await this.running.get(s.engine);
    if (!run) return null;
    const r = await run.conn.setSessionConfigOption({ sessionId: s.id, configId, value });
    s.configOptions = r.configOptions ?? s.configOptions;
    return s.configOptions;
  }

  stopAll() {
    for (const p of this.running.values()) void p.then((r) => r.proc.kill()).catch(() => {});
    this.running.clear();
  }
}
