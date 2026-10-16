import { createAgent, type AgentRun, type ChatMessage } from '@porygon/core';
import { openaiModel } from '@porygon/core/openai';
import { useSyncExternalStore } from 'react';
import { db, getProfile, getSettings, now, uid } from '@/lib/db';
import { desktop, type ConfigOption, type EngineId, type PermissionAsk, type ToolUpdate } from '@/lib/desktop';
import type { Chat, Settings } from '@/lib/types';
import { systemPrompt, type ViewContext } from './prompt';
import { buildTools, type ToolHost } from './tools';

/**
 * Live state of the turn in flight. Finished messages are in IndexedDB; this
 * only holds what is still streaming, so any component can render a turn
 * without owning it, and a turn survives navigating between pages.
 */
export interface Live {
  chatId: string;
  text: string;
  tool?: { name: string; args: unknown };
  error?: string;
  /** An external agent wants to use one of its own tools and is waiting for the user. */
  permission?: PermissionAsk;
}

let live: Live | null = null;
let run: AgentRun | null = null;
const listeners = new Set<() => void>();

function set(next: Live | null) {
  live = next;
  listeners.forEach((l) => l());
}

export function useLive(): Live | null {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => live,
  );
}

export function stop() {
  run?.cancel();
  if (live && acpChat === live.chatId) void desktop()?.agent.cancel(live.chatId);
}

/** The engine that runs the agent: the built-in one, or a coding agent in the desktop app. */
export function engineOf(settings: Settings | undefined): EngineId | null {
  const e = settings?.engine;
  return desktop() && e && e !== 'builtin' ? e : null;
}

export async function newChat(): Promise<string> {
  const id = uid();
  await db.chats.add({ id, title: 'New chat', messages: [], createdAt: now(), updatedAt: now() });
  return id;
}

/**
 * A transcript that ends on tool calls without results is rejected by most
 * providers. Close any that a cancelled or crashed turn left open.
 */
function closeDangling(messages: ChatMessage[]): ChatMessage[] {
  const out = [...messages];
  const answered = new Set(out.filter((m) => m.role === 'tool').map((m) => m.toolCallId));
  for (const m of messages) {
    for (const c of m.toolCalls ?? []) {
      if (!answered.has(c.id)) out.push({ role: 'tool', toolCallId: c.id, content: 'Cancelled before it ran.' });
    }
  }
  return out;
}

export async function send(chatId: string, text: string, view: ViewContext, host: ToolHost) {
  if (live) return;
  const settings = await getSettings();
  const provider = settings.providers.find((p) => p.id === settings.activeProviderId) ?? settings.providers[0];
  const chat = await db.chats.get(chatId);
  if (!chat) return;

  const messages: ChatMessage[] = [...closeDangling(chat.messages), { role: 'user', content: text }];
  const title = chat.messages.length ? chat.title : text.replace(/\s+/g, ' ').slice(0, 60);
  const save = (patch: Partial<Chat>) => db.chats.update(chatId, { ...patch, updatedAt: now() });
  await save({ messages, title });

  const engine = engineOf(settings);
  if (engine) {
    await sendAcp(chatId, engine, settings, messages, view, save);
    return;
  }

  if (!provider?.model) {
    set({ chatId, text: '', error: 'Connect an AI provider and pick a model in Settings first.' });
    return;
  }

  set({ chatId, text: '' });
  const agent = createAgent({
    model: openaiModel({
      baseURL: provider.baseURL,
      model: provider.model,
      apiKey: provider.apiKey,
      // Meridian keys its sessions on this; other providers ignore it.
      fetchImpl: (url, init) =>
        fetch(url, {
          ...init,
          headers: {
            ...(init.headers as Record<string, string>),
            ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
            'x-session-affinity': `questlog-${chatId}`,
          },
        }),
    }),
    tools: buildTools(host),
    systemPrompt: systemPrompt(await getProfile(), view),
    // Analyzing an upload reads and writes many records in one turn.
    limits: { maxSteps: 80 },
  });

  run = agent.run(messages);
  try {
    for await (const ev of run) {
      if (ev.type === 'text') set({ ...live!, text: live!.text + ev.text });
      else if (ev.type === 'tool:start') set({ ...live!, tool: { name: ev.name, args: ev.args } });
      else if (ev.type === 'tool:result') set({ ...live!, tool: undefined });
      else if (ev.type === 'appended') {
        messages.push(...ev.messages);
        await save({ messages: [...messages] });
        // The streamed text now lives in the saved assistant message.
        if (ev.messages.some((m) => m.role === 'assistant')) set({ ...live!, text: '' });
      } else if (ev.type === 'error') set({ ...live!, error: ev.message });
    }
    const result = await run.result;
    if (result.text.trim()) messages.push({ role: 'assistant', content: result.text });
    await save({ messages: closeDangling(messages) });
    const cur = live as Live | null;
    set(cur?.error ? { ...cur, text: '' } : null);
  } catch (err) {
    await save({ messages: closeDangling(messages) });
    set({ chatId, text: '', error: err instanceof Error ? err.message : String(err) });
  } finally {
    run = null;
  }
}

let acpChat: string | null = null;

/** The session options (model, effort) each chat's external agent offers, as it last reported them. */
const sessionOptions = new Map<string, ConfigOption[]>();
const optionListeners = new Set<() => void>();
desktop()?.agent.onSession(({ chatId, configOptions }) => {
  sessionOptions.set(chatId, configOptions);
  optionListeners.forEach((l) => l());
});

export function useSessionOptions(chatId: string | null): ConfigOption[] | undefined {
  return useSyncExternalStore(
    (l) => (optionListeners.add(l), () => optionListeners.delete(l)),
    () => (chatId ? sessionOptions.get(chatId) : undefined),
  );
}

export async function setSessionOption(chatId: string, engine: EngineId, configId: string, value: string) {
  const s = await getSettings();
  await db.settings.put({ ...s, engineOptions: { ...s.engineOptions, [engine]: { ...s.engineOptions?.[engine], [configId]: value } } });
  const opts = await desktop()?.agent.setOption(chatId, configId, value);
  if (opts) {
    sessionOptions.set(chatId, opts);
    optionListeners.forEach((l) => l());
  }
}

/** Tool names as the engines report them ("mcp__questlog__save_job", "questlog.save_job") back to Questlog's own. */
const toolName = (title: string) => title.replace(/^(mcp__)?questlog(__|_|\.|\/|: ?)/i, '').trim();

function toolText(u: ToolUpdate): string {
  const parts = (u.content ?? []).map((c) => c.content?.text ?? '').filter(Boolean);
  if (parts.length) return parts.join('\n');
  if (u.rawOutput !== undefined) return typeof u.rawOutput === 'string' ? u.rawOutput : JSON.stringify(u.rawOutput);
  return u.status === 'failed' ? 'Error' : 'Done.';
}

/**
 * One turn with an external agent over ACP. Its stream of updates is folded
 * into the same messages the built-in agent writes, so the panel, history and
 * links all work the same.
 */
async function sendAcp(chatId: string, engine: EngineId, settings: Settings, messages: ChatMessage[], view: ViewContext, save: (p: Partial<Chat>) => Promise<unknown>) {
  const d = desktop()!;
  acpChat = chatId;
  set({ chatId, text: '' });
  const calls = new Map<string, { name: string; args: unknown; msg: ChatMessage }>();
  const flush = () => {
    if (live?.text.trim()) messages.push({ role: 'assistant', content: live.text });
    if (live) set({ ...live, text: '' });
  };
  const offUpdate = d.agent.onUpdate(({ chatId: c, update: u }) => {
    if (c !== chatId || !live) return;
    if (u.sessionUpdate === 'agent_message_chunk') {
      const t = (u as { content: { text?: string } }).content.text;
      if (t) set({ ...live, text: live.text + t });
    } else if (u.sessionUpdate === 'tool_call' || u.sessionUpdate === 'tool_call_update') {
      const t = u as ToolUpdate;
      let call = calls.get(t.toolCallId);
      if (!call) {
        flush();
        const name = toolName(t.title ?? t.kind ?? 'tool');
        const msg: ChatMessage = { role: 'assistant', content: '', toolCalls: [{ id: t.toolCallId, name, arguments: JSON.stringify(t.rawInput ?? {}) }] };
        call = { name, args: t.rawInput ?? {}, msg };
        calls.set(t.toolCallId, call);
        messages.push(msg);
        void save({ messages: [...messages] });
      } else if (t.rawInput !== undefined || t.title) {
        // Engines often send the arguments, or a better title, in a later update.
        if (t.rawInput !== undefined) call.args = t.rawInput;
        if (t.title) call.name = toolName(t.title);
        call.msg.toolCalls = [{ id: t.toolCallId, name: call.name, arguments: JSON.stringify(call.args) }];
      }
      if (t.status === 'completed' || t.status === 'failed') {
        messages.push({ role: 'tool', toolCallId: t.toolCallId, content: t.status === 'failed' ? `Error: ${toolText(t)}` : toolText(t) });
        set({ ...live, tool: undefined });
        void save({ messages: [...messages] });
      } else set({ ...live, tool: { name: call.name, args: call.args } });
    }
  });
  const offAsk = d.agent.onPermission((p) => {
    if (p.chatId === chatId && live) set({ ...live, permission: p });
  });
  try {
    const last = messages.at(-1)?.content ?? '';
    const where = view.label ? `[The user is looking at ${view.label}, at ${view.path} in Questlog.]` : `[The user is at ${view.path} in Questlog.]`;
    const res = await d.agent.prompt({
      chatId,
      engine,
      text: `${where}\n\n${last}`,
      system: systemPrompt(await getProfile(), view),
      options: settings.engineOptions?.[engine],
    });
    flush();
    await save({ messages: closeDangling(messages) });
    if (res.error) {
      const hint = res.auth || /auth|log ?in|credential/i.test(res.error) ? ' Log in to it in a terminal first (e.g. run `claude` or `codex login`), then try again.' : '';
      set({ chatId, text: '', error: `${res.error}${hint}` });
    } else set(null);
  } catch (err) {
    flush();
    await save({ messages: closeDangling(messages) });
    set({ chatId, text: '', error: err instanceof Error ? err.message : String(err) });
  } finally {
    offUpdate();
    offAsk();
    acpChat = null;
  }
}

/** Answer an external agent's request to use one of its own tools. */
export function answerPermission(optionId: string | null) {
  const p = live?.permission;
  if (!p) return;
  void desktop()?.agent.answer(p.id, optionId);
  set({ ...live!, permission: undefined });
}

export function clearError() {
  if (live?.error) set(null);
}

/** Lets any page hand the assistant a request, e.g. a "Tailor resume" button. */
const asks = new EventTarget();

export function ask(text: string) {
  asks.dispatchEvent(new CustomEvent('ask', { detail: text }));
}

export function onAsk(fn: (text: string) => void) {
  const h = (e: Event) => fn((e as CustomEvent<string>).detail);
  asks.addEventListener('ask', h);
  return () => asks.removeEventListener('ask', h);
}
