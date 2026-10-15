import { createAgent, type AgentRun, type ChatMessage } from '@porygon/core';
import { openaiModel } from '@porygon/core/openai';
import { useSyncExternalStore } from 'react';
import { db, getProfile, getSettings, now, uid } from '@/lib/db';
import type { Chat } from '@/lib/types';
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
            'x-session-affinity': `offerdex-${chatId}`,
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
