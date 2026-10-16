import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import type { ChatMessage } from '@porygon/core';
import {
  ArrowUp, ArrowUpRight, BriefcaseBusiness, Check, ChevronRight, ClipboardPen, FileText, History, Loader2, MessageSquarePlus, PanelRightClose, Plug, Sparkles, Square, Trash2, UserRound, X,
} from 'lucide-react';
import { desktop, isDesktop, type ConfigOption, type Engine, type PermissionAsk } from '@/lib/desktop';
import { db, getSettings } from '@/lib/db';
import { answerPermission, clearError, engineOf, newChat, onAsk, send, setSessionOption, stop, useLive, useSessionOptions } from '@/agent/runtime';
import { Button } from '@/components/ui/button';
import { Markdown } from '@/components/Markdown';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { Tip } from '@/components/ui/tooltip';
import { cn, timeAgo } from '@/lib/utils';
import { useWorkspace } from '@/lib/workspace';

const CHAT_KEY = 'questlog:chat';

/** Friendly verbs for tool calls, so the transcript reads like a log of work. */
function describe(name: string, args: Record<string, unknown>): string {
  const a = (k: string) => (typeof args?.[k] === 'string' ? (args[k] as string) : '');
  switch (name) {
    case 'get_profile': return 'Read your profile';
    case 'update_profile': return 'Updated your profile';
    case 'list_jobs': return `Looked through ${a('stage') || (args?.moonshot ? 'moonshots' : '')} listings`.replace(/\s+/g, ' ');
    case 'get_job': return 'Opened a listing';
    case 'save_job': return `Saved ${[a('company'), a('title')].filter(Boolean).join(': ') || 'a listing'}${a('stage') ? ` → ${a('stage')}` : ''}`;
    case 'log_job': return 'Added a note';
    case 'set_company_websites': return 'Found company logos';
    case 'delete_job': return 'Deleted a listing';
    case 'search_board': return `Searched ${a('board')} on ${a('ats')}`;
    case 'read_posting': return 'Read a posting';
    case 'list_documents': return 'Looked through documents';
    case 'get_document': return 'Opened a document';
    case 'save_resume': return `Wrote resume “${a('title')}”`;
    case 'save_letter': return `Wrote letter “${a('title')}”`;
    case 'save_answer': return `Wrote answer “${a('title')}”`;
    case 'delete_document': return 'Deleted a document';
    case 'get_design': return 'Read the design';
    case 'edit_design': return 'Restyled the page';
    case 'set_design': return a('css').trim() ? 'Redesigned the page' : 'Restored the default design';
    case 'copy_design': return 'Copied the design';
    case 'show': return `Opened ${a('path')}`;
    case 'open_application': return 'Opened the application';
    case 'read_form': return 'Read the form';
    case 'fill_form': return `Filled ${Array.isArray(args?.fields) ? args.fields.length : ''} fields`.replace(/\s+/g, ' ');
    case 'attach_document': return 'Attached a document';
    case 'click_form': return 'Clicked on the form';
    case 'read_page': return 'Read the page';
    default: return name;
  }
}

function parseArgs(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw); } catch { return {}; }
}

/** The page a tool call changed or read, so each line in the log can take you there. */
function target(name: string, args: Record<string, unknown>, result?: ChatMessage): string | undefined {
  const id = typeof args?.id === 'string' ? args.id : undefined;
  if (/job/.test(name) && id) return `/jobs/${encodeURIComponent(id)}`;
  if (/document|design|resume|letter|answer/.test(name)) {
    const made = result?.content.match(/\(id ([\w-]+)\)/)?.[1];
    if (id || made) return `/documents/${id ?? made}`;
  }
  return undefined;
}

function ToolLine({ name, args, result, running }: { name: string; args: Record<string, unknown>; result?: ChatMessage; running?: boolean }) {
  const [open, setOpen] = useState(false);
  const to = target(name, args, result);
  const failed = result?.content.startsWith('Error') || result?.content.startsWith('No ');
  return (
    <div className="text-[12.5px]">
      <button
        onClick={() => setOpen(!open)}
        className="group flex w-full items-center gap-2 rounded-md py-0.5 text-left text-muted-foreground hover:text-foreground"
      >
        <span className={cn('grid size-4 place-items-center rounded-full', running ? 'text-foreground' : failed ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success')}>
          {running ? <Loader2 className="size-3 animate-spin" /> : failed ? <X className="size-2.5" /> : <Check className="size-2.5" strokeWidth={3} />}
        </span>
        <span className="truncate">{describe(name, args)}</span>
        {to && !/^(get|list)_/.test(name) && (
          <Link to={to} onClick={(e) => e.stopPropagation()} className="shrink-0 rounded px-1 text-[11.5px] font-medium text-foreground/70 hover:bg-accent hover:text-foreground">
            <ArrowUpRight className="inline size-3" /> view
          </Link>
        )}
        {result && <ChevronRight className={cn('ml-auto size-3.5 shrink-0 opacity-0 transition group-hover:opacity-100', open && 'rotate-90 opacity-100')} />}
      </button>
      {open && result && (
        <pre className="scroll-thin ml-6 mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-sunken p-2.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {result.content.slice(0, 6000)}
        </pre>
      )}
    </div>
  );
}

function Transcript({ messages }: { messages: ChatMessage[] }) {
  const results = useMemo(() => new Map(messages.filter((m) => m.role === 'tool').map((m) => [m.toolCallId, m])), [messages]);
  return (
    <>
      {messages.map((m, i) => {
        if (m.role === 'user') {
          return (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-[13.5px] leading-relaxed text-primary-foreground">
                {m.content}
              </div>
            </div>
          );
        }
        if (m.role === 'assistant') {
          return (
            <div key={i} className="space-y-1.5">
              {m.content.trim() && <Markdown text={m.content} />}
              {m.toolCalls?.length ? (
                <div className="space-y-0.5">
                  {m.toolCalls.map((c) => <ToolLine key={c.id} name={c.name} args={parseArgs(c.arguments)} result={results.get(c.id)} />)}
                </div>
              ) : null}
            </div>
          );
        }
        return null;
      })}
    </>
  );
}

/** An external agent asking to use one of its own tools (not Questlog's), with the choices it offers. */
function PermissionCard({ ask }: { ask: PermissionAsk }) {
  const input = ask.input === undefined ? '' : typeof ask.input === 'string' ? ask.input : JSON.stringify(ask.input, null, 1);
  // The agent waits on this, so it must not sit unseen below the fold.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), [ask.id]);
  return (
    <div ref={ref} className="pop rounded-2xl border border-gold/50 bg-gold-soft/40 p-3.5 text-[13px]">
      <p className="font-medium">The agent wants to {ask.title ? <span className="font-mono text-[12px]">{ask.title}</span> : 'use a tool'}</p>
      {input && <pre className="scroll-thin mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-background/70 p-2 font-mono text-[11px] text-muted-foreground">{input.slice(0, 2000)}</pre>}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {ask.options.map((o) => (
          <Button key={o.optionId} size="sm" variant={o.kind === 'allow_once' ? 'gold' : 'outline'} onClick={() => answerPermission(o.optionId)}>{o.name}</Button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => answerPermission(null)}>Stop</Button>
      </div>
    </div>
  );
}

/** Model and effort pickers for an external agent, from what its session offers. */
function SessionPicker({ chatId, engine, options }: { chatId: string; engine: Engine['id']; options: ConfigOption[] }) {
  const shown = options.filter((o) => o.type === 'select' && (o.category === 'model' || o.category === 'thought_level' || o.id === 'model' || o.id === 'effort'));
  return (
    <>
      {shown.map((o) => {
        const flat = (o.options ?? []).flatMap((x) => ('group' in x ? x.options : [x]));
        return (
          <select
            key={o.id}
            value={String(o.currentValue)}
            onChange={(e) => void setSessionOption(chatId, engine, o.id, e.target.value)}
            title={o.name}
            className="h-7 max-w-[130px] truncate rounded-md bg-transparent px-1 font-mono text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground focus:outline-none"
          >
            {flat.map((x) => <option key={x.value} value={x.value}>{x.name}</option>)}
          </select>
        );
      })}
    </>
  );
}

function useViewContext() {
  const { pathname } = useLocation();
  const { behind, applyJobId } = useWorkspace();
  const applying = behind === 'apply' && !!applyJobId;
  const jobId = applying ? applyJobId : pathname.startsWith('/jobs/') ? decodeURIComponent(pathname.slice(6)) : undefined;
  const docId = !applying && pathname.startsWith('/documents/') ? pathname.slice(11) : undefined;
  const job = useLiveQuery(() => (jobId ? db.jobs.get(jobId) : undefined), [jobId]);
  const doc = useLiveQuery(() => (docId ? db.docs.get(docId) : undefined), [docId]);
  const label = job
    ? applying
      ? `the application form for listing ${job.id}: ${job.company}, ${job.title}. The form is in a frame you can't see or fill; the user pastes from their documents`
      : `listing ${job.id}: ${job.company}, ${job.title}`
    : doc ? `${doc.kind} ${doc.id}: ${doc.title}` : undefined;
  return { path: pathname, label, job, doc, applying };
}

export function ChatPanel({ onClose, mobile }: { onClose?: () => void; mobile?: boolean }) {
  const navigate = useNavigate();
  const live = useLive();
  const view = useViewContext();
  const [chatId, setChatId] = useState<string | null>(() => localStorage.getItem(CHAT_KEY));
  const chat = useLiveQuery(() => (chatId ? db.chats.get(chatId) : undefined), [chatId]);
  const chats = useLiveQuery(() => db.chats.orderBy('updatedAt').reverse().limit(30).toArray(), []);
  const settings = useLiveQuery(() => getSettings(), []);
  const provider = settings?.providers.find((p) => p.id === settings.activeProviderId) ?? settings?.providers[0];
  const engine = engineOf(settings);
  const [engines, setEngines] = useState<Engine[]>([]);
  useEffect(() => void desktop()?.agent.engines().then(setEngines), []);
  const engineLabel = engines.find((e) => e.id === engine)?.label ?? engine;
  const sessionOpts = useSessionOptions(chatId);
  const [draft, setDraft] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const running = !!live && !live.error && live.chatId === chatId;

  useEffect(() => {
    if (chatId) localStorage.setItem(CHAT_KEY, chatId);
  }, [chatId]);

  // Stick to the bottom while new content arrives.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [chat?.messages.length, live?.text, live?.tool]);

  // On a phone, focusing would pop the keyboard over the transcript.
  useEffect(() => {
    if (!mobile) input.current?.focus();
  }, [chatId, mobile]);

  async function submit(text = draft) {
    text = text.trim();
    if (!text || live && !live.error) return;
    clearError();
    let id = chat ? chatId : null;
    if (!id) {
      id = await newChat();
      setChatId(id);
    }
    setDraft('');
    void send(id, text, { path: view.path, label: view.label }, { navigate });
  }

  // Requests from page buttons. Read through a ref so the handler sees the latest state.
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => onAsk((text) => void submitRef.current(text)), []);

  async function startNew() {
    setChatId(await newChat());
  }

  const suggestions = view.applying && view.job
    ? ['Help me answer a question on this form', `Draft a short "Additional information" answer`, 'I submitted it. Mark it applied']
    : view.job
    ? [`Is ${view.job.company} a fit for me?`, 'Tailor my resume for this role', isDesktop() ? 'Fill out this application for me' : 'Draft a short "Additional information" answer']
    : view.doc?.kind === 'resume'
      ? ['Tighten this resume to fit one page', 'Give this resume a fresh, modern design', 'Which listings is this resume best for?']
      : view.doc?.kind === 'letter'
      ? ['Match this letter’s design to its resume', 'Tighten this letter']
      : ['Sort my New roles: save the good ones, pass on the rest', 'Line up my best 5 roles for this week', 'Search Anduril’s job board for mechanical roles near me'];

  const empty = !chat || chat.messages.length === 0;

  return (
    <aside className="flex h-full min-w-0 flex-col bg-surface">
      <div className="flex h-14 shrink-0 items-center gap-1 border-b border-border/60 px-3 max-lg:[&_button]:size-10">
        <Sparkles className="ml-1 size-4 text-gold" />
        <div className="ml-1.5 min-w-0 flex-1 leading-tight">
          <p className="truncate text-[13.5px] font-semibold">{chat && chat.messages.length ? chat.title : 'Agent'}</p>
          <p className="truncate text-[11px] text-muted-foreground">Runs everything in Questlog</p>
        </div>
        <Menu>
          <Tip label="History"><MenuTrigger asChild><Button variant="ghost" size="icon" aria-label="History"><History /></Button></MenuTrigger></Tip>
          <MenuContent className="w-72">
            <MenuLabel>Recent chats</MenuLabel>
            {chats?.length ? chats.map((c) => (
              <MenuItem key={c.id} onSelect={() => setChatId(c.id)} active={c.id === chatId}>
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                <span className="text-[11px] text-muted-foreground">{timeAgo(c.updatedAt)}</span>
              </MenuItem>
            )) : <p className="px-2.5 py-2 text-[13px] text-muted-foreground">No chats yet</p>}
            {chat && (
              <>
                <MenuSeparator />
                <MenuItem danger onSelect={async () => { await db.chats.delete(chat.id); setChatId(null); }}>
                  <Trash2 /> Delete this chat
                </MenuItem>
              </>
            )}
          </MenuContent>
        </Menu>
        <Tip label="New chat"><Button variant="ghost" size="icon" onClick={startNew} aria-label="New chat"><MessageSquarePlus /></Button></Tip>
        {onClose && <Tip label="Hide (⌘J)"><Button variant="ghost" size="icon" onClick={onClose} aria-label="Hide agent"><PanelRightClose /></Button></Tip>}
      </div>

      <div ref={scroller} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-5">
        {empty && !running ? (
          <div className="flex h-full flex-col justify-end pb-2">
            <div className="rise mb-5">
              {/* A slowly breathing glow behind the mark. */}
              <div className="relative mb-5 size-12">
                <div className="absolute -inset-4 animate-[breathe_4s_ease-in-out_infinite] rounded-full bg-[radial-gradient(closest-side,hsl(var(--gold)/0.35),transparent)]" />
                <div className="relative grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-gold to-[hsl(36_100%_58%)] text-gold-foreground shadow-[0_8px_24px_-8px_hsl(var(--gold)/0.8)]">
                  <Sparkles className="size-6" />
                </div>
              </div>
              <p className="font-display text-[21px]">What should we <span className="text-gradient">take on</span>?</p>
              <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
                I’m not just a chat. I work the app for you, with the same controls you have, and each change shows up on the page as I make it.
              </p>
            </div>
            <ul className="rise mb-5 space-y-2.5 rounded-2xl border border-border/70 bg-background/50 p-3.5 text-[13px]" style={{ '--i': 1 } as React.CSSProperties}>
              {([
                [<BriefcaseBusiness key="j" />, 'Jobs', 'search company job boards, sort what’s new, line up what to send'],
                [<FileText key="d" />, 'Documents', 'tailor and redesign resumes, write letters and answers'],
                [<UserRound key="p" />, 'Your profile', 'keep your rules, facts and notes current'],
                [<ClipboardPen key="a" />, 'Applications', isDesktop() ? 'fill in forms and attach your resume; you press Submit' : 'draft your answers (the desktop app also fills in forms)'],
              ] as const).map(([icon, title, text]) => (
                <li key={title} className="flex gap-3">
                  <span className="mt-0.5 text-muted-foreground [&_svg]:size-4">{icon}</span>
                  <span><span className="font-medium">{title}:</span> <span className="text-muted-foreground">{text}</span></span>
                </li>
              ))}
            </ul>
            <p className="eyebrow-label mb-2 px-1">Try</p>
            <div className="space-y-2">
              {suggestions.map((s, i) => (
                <button
                  key={s}
                  onClick={() => submit(s)}
                  className="rise group flex w-full items-center gap-2 rounded-2xl border border-border/70 bg-background/60 px-3.5 py-2.5 text-left text-[13.5px] transition-[background-color,border-color,transform] duration-200 hover:-translate-y-px hover:border-gold/40 hover:bg-accent/60 active:scale-[0.99]"
                  style={{ '--i': i + 2 } as React.CSSProperties}
                >
                  <span className="flex-1">{s}</span>
                  <ArrowUp className="size-3.5 rotate-45 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {chat && <Transcript messages={chat.messages} />}
            {live && live.chatId === chatId && (
              <div className="space-y-1.5">
                {live.text && <Markdown text={live.text} />}
                {live.tool && <ToolLine name={live.tool.name} args={(live.tool.args ?? {}) as Record<string, unknown>} running />}
                {running && !live.text && !live.tool && (
                  <div className="flex items-center gap-1.5 py-1">
                    {[0, 1, 2].map((i) => (
                      <span key={i} className="size-1.5 animate-pulse rounded-full bg-muted-foreground/60" style={{ animationDelay: `${i * 150}ms` }} />
                    ))}
                  </div>
                )}
                {live.permission && <PermissionCard ask={live.permission} />}
                {live.error && (
                  <div className="rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-[13px] text-danger">
                    {live.error}
                    {/provider|Settings/.test(live.error) && (
                      <Link to="/settings" className="ml-1 font-medium underline">Open settings</Link>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 p-3 pt-0">
        {settings && !engine && !provider?.model && (
          <Link to="/settings" className="mb-2 flex items-center gap-2 rounded-xl bg-gold-soft px-3 py-2 text-[12.5px] ring-1 ring-gold/50 hover:brightness-[0.98]">
            <Plug className="size-3.5" />
            {isDesktop() ? 'Pick who runs the agent: Claude Code, Codex, OpenCode, or an AI provider.' : 'Connect an AI provider to start. Meridian works out of the box.'}
          </Link>
        )}
        <div className="rounded-[20px] border border-border/80 bg-background shadow-card transition-[border-color,box-shadow] duration-300 focus-within:border-gold/50 focus-within:shadow-[0_0_0_4px_hsl(var(--gold)/0.12),0_10px_30px_-12px_hsl(var(--gold)/0.4)]">
          {view.label && (
            <div className="flex items-center gap-1.5 px-3 pt-2.5 text-[11.5px] text-muted-foreground">
              <span className="size-1.5 rounded-full bg-gold" />
              <span className="truncate">{view.applying ? 'Applying to' : 'Looking at'} {view.job ? `${view.job.company}: ${view.job.title}` : view.doc?.title}</span>
            </div>
          )}
          <textarea
            ref={input}
            value={draft}
            rows={1}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !mobile) {
                e.preventDefault();
                void submit();
              }
            }}
            enterKeyHint={mobile ? 'enter' : 'send'}
            placeholder="Tell me what to do, or paste a posting link…"
            className="block max-h-48 min-h-[44px] w-full resize-none bg-transparent px-3.5 py-3 text-[13.5px] leading-relaxed max-lg:text-[16px] placeholder:text-muted-foreground/70 focus:outline-none [field-sizing:content]"
          />
          <div className="flex items-center justify-between px-2 pb-2">
            <div className="flex min-w-0 items-center gap-0.5">
              <Link to="/settings" className="truncate rounded-md px-1.5 py-1 font-mono text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground">
                {engine ? engineLabel : provider ? `${provider.name} · ${provider.model ?? 'no model'}` : 'No provider'}
              </Link>
              {engine && chatId && sessionOpts && <SessionPicker chatId={chatId} engine={engine} options={sessionOpts} />}
            </div>
            {running ? (
              <Button size="icon" variant="primary" onClick={stop} className="rounded-full max-lg:size-10" aria-label="Stop">
                <Square className="!size-3 fill-current" />
              </Button>
            ) : (
              <Button size="icon" variant="gold" onMouseDown={(e) => e.preventDefault()} onClick={() => submit()} disabled={!draft.trim()} className="rounded-full max-lg:size-10" aria-label="Send">
                <ArrowUp />
              </Button>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
