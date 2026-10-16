import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ArrowUp, Sparkles } from 'lucide-react';
import { ask, useLive } from '@/agent/runtime';
import { cn } from '@/lib/utils';
import { isDesktop } from '@/lib/desktop';

/** Things worth asking for on each page, shown one at a time as the placeholder. */
function examples(path: string): string[] {
  if (path.startsWith('/jobs/'))
    return [
      'Is this a fit for me?',
      'Tailor my resume for this role',
      isDesktop() ? 'Fill out this application for me' : 'Draft my answers for this application',
      'Write a short cover letter for this one',
    ];
  if (['/listings', '/pipeline', '/map', '/moonshots'].includes(path))
    return [
      'Sort my New roles: save the good ones, pass on the rest',
      'Find mechanical roles at SpaceX and Anduril',
      'Line up my best 5 for this week',
      'Close everything that pays under my floor',
    ];
  if (path.startsWith('/documents'))
    return ['Make my resume fit on one page', 'Give my resume a clean two-column design', 'Write a cover letter for my next application'];
  return ['Line up 5 roles for this week', 'Sort my New roles', 'Tailor my resume for the next one', 'What should I do today?'];
}

/**
 * Tell the agent what to do from any page. It opens the agent panel with the
 * request running, so the work happens where you can watch it.
 */
export function CommandDock({ className, mobile }: { className?: string; mobile?: boolean }) {
  const { pathname } = useLocation();
  const live = useLive();
  const busy = !!live && !live.error;
  const [text, setText] = useState('');
  const [n, setN] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = examples(pathname);

  // A new example every few seconds, while the field is empty and unfocused.
  useEffect(() => {
    if (text) return;
    const t = setInterval(() => {
      if (document.activeElement !== input.current) setN((i) => i + 1);
    }, 4500);
    return () => clearInterval(t);
  }, [text]);
  useEffect(() => setN(0), [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = (v = text) => {
    v = v.trim();
    if (!v || busy) return;
    ask(v);
    setText('');
    input.current?.blur();
  };
  const example = list[n % list.length];

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      className={cn(
        'group pointer-events-auto flex w-full items-center gap-2 rounded-full border border-border/80 bg-surface/90 p-1.5 pl-4 shadow-lift backdrop-blur-xl transition-[border-color,box-shadow] duration-300',
        'focus-within:border-gold/60 focus-within:shadow-[0_0_0_4px_hsl(var(--gold)/0.14),0_16px_40px_-16px_hsl(var(--gold)/0.5)]',
        className,
      )}
    >
      <Sparkles className={cn('size-4 shrink-0 text-gold', busy && 'animate-pulse')} />
      <div className="relative min-w-0 flex-1">
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Tab takes the example shown, so the suggestions are one key away.
            if (e.key === 'Tab' && !text) { e.preventDefault(); setText(example); }
          }}
          aria-label="Tell the agent what to do"
          enterKeyHint="send"
          className={cn('h-9 w-full bg-transparent text-[14px] outline-none', mobile && 'text-[16px]')}
        />
        {!text && (
          <span key={example} className="pointer-events-none absolute inset-y-0 left-0 flex max-w-full items-center truncate text-[14px] text-muted-foreground animate-in fade-in-0 duration-500">
            {busy ? 'The agent is working… add to it in the panel' : <>Tell Questlog what to do: <span className="ml-1 truncate text-foreground/60">“{example}”</span></>}
          </span>
        )}
      </div>
      {!mobile && !text && <kbd className="hidden shrink-0 rounded-md border border-border/80 px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground sm:block">⌘K</kbd>}
      <button
        type="submit"
        disabled={!text.trim() || busy}
        aria-label="Send to the agent"
        className="grid size-9 shrink-0 place-items-center rounded-full bg-gold text-gold-foreground transition disabled:opacity-40 [&_svg]:size-4"
      >
        <ArrowUp />
      </button>
    </form>
  );
}
