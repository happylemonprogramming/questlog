import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, ArrowLeft, Check, Clock, MapPin, ThumbsDown, ThumbsUp, Undo2, Wallet, X } from 'lucide-react';
import { db, moveJob, now } from '@/lib/db';
import { candidates, lineup, QUEUE_SIZE } from '@/lib/queue';
import { CompanyMark, shortPay } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Job, Stage } from '@/lib/types';
import { cn } from '@/lib/utils';

type Choice = 'keep' | 'later' | 'no';

/**
 * Decide on roles one at a time. With too many lined up, pick the few to keep
 * in Next up; with too few, pick new ones to line up. One card, three choices,
 * and an undo, so no single decision feels heavy.
 */
export default function Review() {
  const navigate = useNavigate();
  const jobs = useLiveQuery(() => db.jobs.toArray(), []);
  // The deck is fixed when the page opens, so cards don't reshuffle as you decide.
  const [deck, setDeck] = useState<{ mode: 'trim' | 'fill'; ids: string[] }>();
  const [i, setI] = useState(0);
  const [history, setHistory] = useState<{ id: string; from: Stage }[]>([]);
  useEffect(() => {
    if (!jobs || deck) return;
    const queue = lineup(jobs);
    setDeck(queue.length > QUEUE_SIZE ? { mode: 'trim', ids: queue.map((j) => j.id) } : { mode: 'fill', ids: candidates(jobs).map((j) => j.id) });
  }, [jobs, deck]);

  const byId = useMemo(() => new Map((jobs ?? []).map((j) => [j.id, j])), [jobs]);
  const queued = jobs ? lineup(jobs).length : 0;
  const job = deck && byId.get(deck.ids[i]);
  const trim = deck?.mode === 'trim';
  const kept = trim ? history.filter((h) => byId.get(h.id)?.stage === 'next').length : queued;
  const done = !!deck && (i >= deck.ids.length || (trim ? kept >= QUEUE_SIZE : queued >= QUEUE_SIZE));
  const rest = trim && deck ? deck.ids.slice(i).map((id) => byId.get(id)).filter((j): j is Job => j?.stage === 'next') : [];

  async function decide(c: Choice) {
    if (!job) return;
    setHistory((h) => [...h, { id: job.id, from: job.stage }]);
    setI((n) => n + 1);
    if (c === 'keep' && job.stage !== 'next') await moveJob(job, 'next', 'Lined up in review');
    if (c === 'later' && job.stage !== 'saved') await moveJob(job, 'saved', 'Set aside in review');
    if (c === 'no') {
      await moveJob(job, 'closed', 'Passed in review');
      await db.jobs.update(job.id, { outcome: 'skipped' });
    }
  }

  async function undo() {
    const last = history.at(-1);
    if (!last) return;
    const j = byId.get(last.id);
    setHistory((h) => h.slice(0, -1));
    setI((n) => n - 1);
    if (j && j.stage !== last.from) await db.jobs.update(j.id, { stage: last.from, log: j.log?.slice(0, -1), updatedAt: now() });
  }

  async function setAsideRest() {
    for (const j of rest) await moveJob(j, 'saved', 'Set aside in review');
    navigate('/');
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select')) return;
      if (done) return;
      if (e.key === 'ArrowRight') void decide('keep');
      if (e.key === 'ArrowDown') void decide('later');
      if (e.key === 'ArrowLeft') void decide('no');
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') void undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!deck) return null;
  const total = deck.ids.length;

  return (
    <div className="mx-auto max-w-[560px]">
      <Link to="/" className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground max-lg:hidden">
        <ArrowLeft className="size-3.5" /> Today
      </Link>
      <h1 className="text-[28px] font-semibold tracking-[-0.03em] sm:text-[32px]">{trim ? `Pick your top ${QUEUE_SIZE}` : 'Line up a few'}</h1>
      <p className="mt-2 text-[15px] text-muted-foreground">
        {trim
          ? `You have ${total} roles in Next up. Keep the ${QUEUE_SIZE} you'd most like to send; the rest go back to Saved, nothing is lost.`
          : `Pick up to ${QUEUE_SIZE} roles to apply to next. One at a time.`}
      </p>

      <div className="mt-6 flex items-center gap-3">
        <div className="flex gap-1.5">
          {Array.from({ length: QUEUE_SIZE }, (_, n) => (
            <span key={n} className={cn('h-1.5 w-6 rounded-full transition-colors duration-500', n < kept ? 'bg-lemon shadow-[0_0_8px_hsl(var(--lemon))]' : 'bg-muted-foreground/20')} />
          ))}
        </div>
        <span className="text-[13px] text-muted-foreground">{Math.min(kept, QUEUE_SIZE)} of {QUEUE_SIZE} lined up</span>
        {history.length > 0 && !done && (
          <button onClick={undo} className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1 text-[13px] font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground">
            <Undo2 className="size-3.5" /> Undo
          </button>
        )}
      </div>

      {done ? (
        <div className="pop mt-6 rounded-[28px] border bg-surface p-8 text-center shadow-card">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-lemon text-lemon-foreground shadow-glow"><Check className="size-6" strokeWidth={3} /></div>
          <p className="text-[19px] font-semibold">{kept ? 'Your queue is set' : 'That’s everything for now'}</p>
          <p className="mx-auto mt-1 max-w-sm text-[14px] text-muted-foreground">
            {rest.length
              ? `${rest.length} more ${rest.length === 1 ? 'role is' : 'roles are'} still in Next up. Set ${rest.length === 1 ? 'it' : 'them'} aside so Today stays short?`
              : kept ? 'Today will walk you through them one at a time.' : 'No new roles to review. Ask the assistant to find some.'}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {rest.length > 0 && <Button variant="lemon" onClick={setAsideRest}>Set {rest.length} aside</Button>}
            <Button variant={rest.length ? 'outline' : 'lemon'} onClick={() => navigate('/')}>Back to Today</Button>
          </div>
        </div>
      ) : job ? (
        <div key={job.id} className="pop mt-6 rounded-[28px] border bg-surface p-6 shadow-card sm:p-7">
          <div className="flex items-start gap-4">
            <CompanyMark name={job.company} size={52} className="rounded-2xl" />
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-medium text-muted-foreground">{job.company}</p>
              <Link to={`/jobs/${encodeURIComponent(job.id)}`} className="mt-0.5 block text-[20px] font-semibold leading-tight tracking-[-0.02em] hover:underline">{job.title}</Link>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
                {job.location && <span className="flex items-center gap-1.5"><MapPin className="size-3.5" />{job.location}</span>}
                {job.pay && <span className="flex items-center gap-1.5 font-mono text-[12.5px]"><Wallet className="size-3.5" />{shortPay(job.pay)}</span>}
              </div>
            </div>
          </div>
          {job.verdict && <p className="mt-5 text-[14.5px] leading-relaxed">{job.verdict}</p>}
          {(job.strengths?.length || job.gaps?.length) ? (
            <ul className="mt-4 space-y-1.5 text-[13.5px]">
              {job.strengths?.slice(0, 2).map((s) => <li key={s} className="flex gap-2"><ThumbsUp className="mt-0.5 size-3.5 shrink-0 text-success" />{s}</li>)}
              {job.gaps?.slice(0, 2).map((s) => <li key={s} className="flex gap-2"><ThumbsDown className="mt-0.5 size-3.5 shrink-0 text-warning" />{s}</li>)}
            </ul>
          ) : null}
          {job.flags?.length ? <div className="mt-4 flex flex-wrap gap-1.5">{job.flags.map((f) => <Badge key={f} tone="warning"><AlertTriangle /> {f}</Badge>)}</div> : null}

          <div className="mt-7 grid grid-cols-3 gap-2">
            <Button variant="outline" size="lg" onClick={() => decide('no')} className="flex-col gap-0.5 h-auto py-2.5"><X /> <span className="text-[12.5px]">Not for me</span></Button>
            <Button variant="outline" size="lg" onClick={() => decide('later')} className="flex-col gap-0.5 h-auto py-2.5"><Clock /> <span className="text-[12.5px]">Later</span></Button>
            <Button variant="lemon" size="lg" onClick={() => decide('keep')} className="flex-col gap-0.5 h-auto py-2.5"><Check /> <span className="text-[12.5px]">{trim ? 'Keep' : 'Line it up'}</span></Button>
          </div>
          <p className="mt-4 text-center font-mono text-[11px] text-muted-foreground max-sm:hidden">{i + 1} of {total} · ← not for me · ↓ later · → {trim ? 'keep' : 'line it up'}</p>
        </div>
      ) : null}
    </div>
  );
}
