import { useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight, ArrowUpRight, CalendarClock, Check, ChevronDown, ClipboardPen, FileText, Layers, MapPin, NotebookPen, PartyPopper, Rocket, Send, Sparkles, Wallet } from 'lucide-react';
import { Markdown } from '@/components/Markdown';
import { db, getProfile, moveJob, today } from '@/lib/db';
import { Card, CardHeader, CompanyMark, Empty, JobRow, shortPay } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ask } from '@/agent/runtime';
import { applicationPage, openApplication } from '@/lib/workspace';
import { candidates, QUEUE_SIZE } from '@/lib/queue';
import type { Doc, Job, Stage } from '@/lib/types';
import { cn, timeAgo } from '@/lib/utils';

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** One line on where things stand, leading with the best news. */
function momentum(c: Record<Stage, number>, sentThisWeek: number) {
  const week = sentThisWeek ? ` ${sentThisWeek} sent this week.` : '';
  if (c.offer) return `${c.offer === 1 ? 'An offer is' : `${c.offer} offers are`} on the table.${week}`;
  if (c.interviewing) return `${c.interviewing} interview${c.interviewing === 1 ? '' : 's'} in motion and ${c.next} more lined up.${week}`;
  if (c.applied) return `${c.applied} application${c.applied === 1 ? '' : 's'} out and ${c.next} lined up.${week}`;
  if (c.next) return `${c.next} role${c.next === 1 ? '' : 's'} lined up. A good day to send the first one.`;
  return 'Add a listing or ask the assistant to search a job board to get started.';
}

const GOAL_KEY = 'offerdex:daily-goal';
const PROGRESS_KEY = 'offerdex:progress';

/** How many applications to aim for today. Tap to change; it's remembered. */
function useGoal() {
  const [goal, setGoal] = useState(() => Number(localStorage.getItem(GOAL_KEY)) || 3);
  const cycle = () => {
    const g = (goal % 5) + 1;
    localStorage.setItem(GOAL_KEY, String(g));
    setGoal(g);
  };
  return [goal, cycle] as const;
}

type Progress = Record<string, { resume?: boolean; opened?: boolean }>;

/** Steps done outside the data: chose the base resume, opened the form. Kept on this device. */
function useProgress() {
  const [p, setP] = useState<Progress>(() => {
    try { return JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{}'); } catch { return {}; }
  });
  const mark = (id: string, step: 'resume' | 'opened') => {
    // Keep the most recent 200 listings.
    const next = Object.fromEntries([[id, { ...p[id], [step]: true }], ...Object.entries(p).filter(([k]) => k !== id)].slice(0, 200));
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(next));
    setP(next);
  };
  return [p, mark] as const;
}

function Goal({ sent, goal, onCycle }: { sent: number; goal: number; onCycle: () => void }) {
  return (
    <button onClick={onCycle} title="Change today's goal" className="group flex items-center gap-3 rounded-full border border-border/70 bg-surface/70 py-1.5 pl-2 pr-4 shadow-soft transition hover:border-foreground/20">
      <span className="flex gap-1">
        {Array.from({ length: goal }, (_, i) => (
          <span key={i} className={cn('size-2.5 rounded-full transition-colors duration-500', i < sent ? 'bg-lemon shadow-[0_0_8px_hsl(var(--lemon))]' : 'bg-muted-foreground/20')} />
        ))}
      </span>
      <span className="text-[13px] font-medium">
        {Math.min(sent, goal)} of {goal} <span className="text-muted-foreground">sent today</span>
      </span>
    </button>
  );
}

function Step({ n, done, current, title, detail, children }: { n: number; done: boolean; current: boolean; title: string; detail?: ReactNode; children?: ReactNode }) {
  return (
    <li className={cn('flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-2xl px-3 py-3 transition-colors duration-300 sm:px-4', current && 'bg-lemon-soft/60 ring-1 ring-lemon/40')}>
      <span
        className={cn(
          'grid size-8 shrink-0 place-items-center rounded-full text-[13px] font-semibold transition-colors duration-300',
          done ? 'bg-lemon text-lemon-foreground' : current ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground',
        )}
      >
        {done ? <Check className="size-4" strokeWidth={3} /> : n}
      </span>
      <div className="min-w-[11rem] flex-1">
        <p className={cn('text-[15px] font-medium', done && 'text-muted-foreground line-through decoration-muted-foreground/40')}>{title}</p>
        {detail && <p className="text-[13px] text-muted-foreground">{detail}</p>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2 max-sm:ml-12">{children}</div>}
    </li>
  );
}

/** The one application to work on now, as three small steps. */
function Focus({ job, resume, baseOk, opened, onMark }: { job: Job; resume?: Doc; baseOk: boolean; opened: boolean; onMark: (step: 'resume' | 'opened') => void }) {
  const navigate = useNavigate();
  const inApp = !!applicationPage(job);
  const ready = !!resume || baseOk;
  const step = !ready ? 1 : !opened ? 2 : 3;
  const open = () => {
    onMark('opened');
    if (inApp) openApplication(job.id);
    else if (job.url) window.open(job.url, '_blank', 'noopener,noreferrer');
  };
  return (
    <div key={job.id} className="pop relative rounded-[28px] bg-gradient-to-br from-lemon/60 via-border to-violet/50 p-px shadow-glow">
      <div className="relative overflow-hidden rounded-[27px] bg-surface p-5 sm:p-7">
        <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-[radial-gradient(closest-side,hsl(var(--lemon)/0.14),transparent)]" />
        <div className="flex items-start gap-4">
          <CompanyMark job={job} size={56} className="rounded-2xl max-sm:hidden" />
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-medium text-muted-foreground">{job.company}</p>
            <Link to={`/jobs/${encodeURIComponent(job.id)}`} className="mt-0.5 block text-[21px] font-semibold leading-tight tracking-[-0.02em] hover:underline sm:text-[24px]">
              {job.title}
            </Link>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
              {job.location && <span className="flex items-center gap-1.5"><MapPin className="size-3.5" />{job.location}</span>}
              {job.pay && !/^not listed/i.test(job.pay) && <span className="flex items-center gap-1.5 font-mono text-[12.5px]"><Wallet className="size-3.5" />{shortPay(job.pay)}</span>}
            </div>
          </div>
        </div>

        <ol className="mt-6 space-y-1.5">
          <Step n={1} done={ready} current={step === 1} title="Tailor your resume" detail={resume ? resume.title : baseOk ? 'Using your base resume' : 'A version aimed at this role'}>
            {resume ? (
              <Button size="sm" variant="ghost" onClick={() => navigate(`/documents/${resume.id}`)}>View</Button>
            ) : baseOk ? null : (
              <>
                <Button size="sm" variant="ghost" onClick={() => onMark('resume')} className="text-muted-foreground">Use my base</Button>
                <Button size="sm" variant={step === 1 ? 'lemon' : 'outline'} onClick={() => ask(`Tailor my resume for ${job.company}: ${job.title} (listing ${job.id}).`)}>
                  <Sparkles /> Tailor it
                </Button>
              </>
            )}
          </Step>
          <Step n={2} done={opened} current={step === 2} title="Fill in the application" detail={inApp ? 'Opens here, next to your answers' : 'Opens the company’s site in a new tab'}>
            {(inApp || job.url) && (
              <Button size="sm" variant={step === 2 ? 'lemon' : 'outline'} onClick={open}>
                {inApp ? <ClipboardPen /> : <ArrowUpRight />} Open it
              </Button>
            )}
          </Step>
          <Step n={3} done={false} current={step === 3} title="Mark it sent" detail="Once you’ve hit submit">
            <Button size="sm" variant={step === 3 ? 'lemon' : 'outline'} onClick={() => moveJob(job, 'applied')}>
              <Send /> I sent it
            </Button>
          </Step>
        </ol>

        <div className="mt-5 flex items-center justify-between gap-3 border-t border-border/60 pt-4 text-[13px]">
          <Link to={`/jobs/${encodeURIComponent(job.id)}`} className="font-medium text-muted-foreground transition hover:text-foreground">Read the listing</Link>
          <button onClick={() => moveJob(job, 'saved', 'Set aside from Today')} className="font-medium text-muted-foreground transition hover:text-foreground">Not now</button>
        </div>
      </div>
    </div>
  );
}

const PER_BATCH = 5;

function Batch({ name, list, offset }: { name: string; list: Job[]; offset: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? list : list.slice(0, PER_BATCH);
  return (
    <div className="mt-3 first:mt-0">
      <div className="flex items-center gap-2 px-3 pb-1.5 pt-2">
        <Layers className="size-3.5 text-muted-foreground" />
        <p className="eyebrow-label">{name}</p>
        <span className="h-px flex-1 bg-border/70" />
        <span className="font-mono text-[11px] text-muted-foreground">{list.length}</span>
      </div>
      {shown.map((j, i) => <JobRow key={j.id} job={j} right={<span />} index={offset + i} />)}
      {list.length > PER_BATCH && (
        <button onClick={() => setAll((a) => !a)} className="ml-3 mt-1 rounded-lg px-2 py-1 text-[12.5px] font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground">
          {all ? 'Show fewer' : `Show all ${list.length}`}
        </button>
      )}
    </div>
  );
}

export default function Today() {
  const profile = useLiveQuery(() => getProfile(), []);
  const jobs = useLiveQuery(() => db.jobs.toArray(), []);
  const docs = useLiveQuery(() => db.docs.orderBy('updatedAt').reverse().toArray(), []) ?? [];
  const [goal, cycleGoal] = useGoal();
  const [progress, mark] = useProgress();
  const [more, setMore] = useState(false);
  const navigate = useNavigate();
  const list = jobs ?? [];

  const next = list.filter((j) => j.stage === 'next');
  const batches = new Map<string, Job[]>();
  for (const j of next) {
    const k = j.batch || 'Unbatched';
    batches.set(k, [...(batches.get(k) ?? []), j]);
  }
  const [focus] = [...batches.values()].flat();
  const resume = focus && docs.find((d) => d.kind === 'resume' && d.jobId === focus.id);
  const moonshots = list.filter((j) => j.moonshot && j.stage !== 'closed').sort((a, b) => (a.moonshotRank ?? 99) - (b.moonshotRank ?? 99)).slice(0, 5);
  const activity = list
    .flatMap((j) => (j.log ?? []).map((l) => ({ ...l, job: j })))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 6);
  const counts = Object.fromEntries((['next', 'applied', 'interviewing', 'offer'] as const).map((s) => [s, list.filter((j) => j.stage === s).length])) as Record<Stage, number>;
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const sentThisWeek = list.filter((j) => j.appliedAt && j.appliedAt >= weekAgo).length;
  const sentToday = list.filter((j) => j.appliedAt === today()).length;
  const first = profile?.name?.split(' ')[0];

  let row = 0;
  const offsets = [...batches.values()].map((l) => {
    const o = row;
    row += Math.min(l.length, PER_BATCH);
    return o;
  });

  return (
    <div className="mx-auto max-w-[720px]">
      <section className="mb-8">
        <p className="eyebrow-label rise mb-4 flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-lemon shadow-[0_0_10px_hsl(var(--lemon))]" />
          {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
        <h1 className="rise text-[34px] font-semibold leading-[1.05] tracking-[-0.04em] sm:text-[44px]" style={{ '--i': 1 } as CSSProperties}>
          {greeting()},{' '}
          <span className="text-gradient">{first || 'friend'}</span>
          <span className="text-gradient">.</span>
        </h1>
        <p className="rise mt-3 text-[15.5px] leading-relaxed text-muted-foreground sm:text-[17px]" style={{ '--i': 2 } as CSSProperties}>
          {!jobs ? '\u00a0' : focus ? (sentToday >= goal ? 'You hit today’s goal. Keep going, or call it a day.' : 'One application at a time. Here’s the next one.') : momentum(counts, sentThisWeek)}
        </p>
        {focus && <div className="rise mt-5" style={{ '--i': 3 } as CSSProperties}><Goal sent={sentToday} goal={goal} onCycle={cycleGoal} /></div>}
      </section>

      {next.length > QUEUE_SIZE && (
        <Link to="/review" className="rise group mb-4 flex items-center gap-3 rounded-2xl border border-border/70 bg-surface/70 px-4 py-3 text-[14px] shadow-soft transition hover:border-foreground/20" style={{ '--i': 4 } as CSSProperties}>
          <Layers className="size-4 shrink-0 text-muted-foreground" />
          <span className="flex-1"><span className="font-medium">{next.length} roles are lined up.</span> <span className="text-muted-foreground">That’s a lot to carry. Pick your top {QUEUE_SIZE}?</span></span>
          <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </Link>
      )}

      <div className="rise" style={{ '--i': 4 } as CSSProperties}>
        {focus ? (
          <Focus job={focus} resume={resume} baseOk={!!progress[focus.id]?.resume} opened={!!progress[focus.id]?.opened} onMark={(step) => mark(focus.id, step)} />
        ) : jobs ? (
          <Card className="p-8 text-center">
            <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-lemon/25 to-violet/20 ring-1 ring-border [&_svg]:size-5">
              {counts.applied || counts.interviewing ? <PartyPopper /> : <CalendarClock />}
            </div>
            <p className="text-[17px] font-semibold">Nothing lined up right now</p>
            <p className="mx-auto mt-1 max-w-sm text-[14px] text-muted-foreground">Pick a few roles you’d like to send next, or ask the assistant to find some.</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {candidates(list).length > 0 && <Button variant="lemon" onClick={() => navigate('/review')}><Layers /> Pick from your saved roles</Button>}
              <Button variant={candidates(list).length ? 'outline' : 'lemon'} onClick={() => ask(`What should I apply to next? Pick up to ${QUEUE_SIZE} and line them up.`)}><Sparkles /> Ask the assistant</Button>
            </div>
          </Card>
        ) : null}
      </div>

      <div className="mt-10 flex flex-wrap justify-center gap-2">
        {focus && next.length < QUEUE_SIZE && candidates(list).length > 0 && (
          <Link to="/review" className="flex items-center gap-1.5 rounded-full px-4 py-2 text-[13.5px] font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground">
            <Layers className="size-4" /> Line up more
          </Link>
        )}
        <button onClick={() => setMore((m) => !m)} aria-expanded={more} className="flex items-center gap-1.5 rounded-full px-4 py-2 text-[13.5px] font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground">
          {more ? 'Show less' : 'See everything'} <ChevronDown className={cn('size-4 transition-transform duration-300', more && 'rotate-180')} />
        </button>
      </div>

      {more && (
        <div className="page-enter mt-6 space-y-6">
          <p className="text-center text-[14px] text-muted-foreground">{momentum(counts, sentThisWeek)}</p>
          <Card>
            <CardHeader title="Lined up" icon={<CalendarClock />} count={next.length} action={<Link to="/listings" className="text-[12.5px] font-medium text-muted-foreground transition hover:text-foreground">All jobs</Link>} />
            <div className="px-3 pb-4">
              {next.length === 0 ? (
                <div className="p-3"><Empty icon={<CalendarClock />} title="Nothing lined up yet">Open a listing and set its stage to Next up, or ask the assistant what to apply to.</Empty></div>
              ) : (
                [...batches].map(([batch, l], i) => <Batch key={batch} name={batch} list={l} offset={offsets[i]} />)
              )}
            </div>
          </Card>

          {profile?.notes?.trim() && (
            <Card>
              <CardHeader title="Working notes" icon={<NotebookPen />} action={<Link to="/settings" className="text-[12.5px] text-muted-foreground hover:text-foreground">Edit</Link>} />
              <div className="scroll-thin max-h-[340px] overflow-y-auto px-6 pb-5">
                <Markdown text={profile.notes} />
              </div>
            </Card>
          )}

          <div className="grid gap-6 @[640px]:grid-cols-2">
            <Card>
              <CardHeader title="Moonshots" icon={<Rocket />} action={<Link to="/moonshots" className="grid size-7 place-items-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground" aria-label="All moonshots"><ArrowRight className="size-4" /></Link>} />
              <div className="px-3 pb-4">
                {moonshots.length ? moonshots.map((j, i) => (
                  <JobRow key={j.id} job={j} compact right={j.stage === 'applied' ? <Badge tone="info">Applied</Badge> : <span />} rank={<span className="w-4 text-center font-mono text-[12px] text-muted-foreground">{i + 1}</span>} />
                )) : <p className="px-3 py-4 text-[13px] text-muted-foreground">Long shots worth a try will show up here.</p>}
              </div>
            </Card>

            <Card>
              <CardHeader title="Recent documents" icon={<FileText />} action={<Link to="/documents" className="grid size-7 place-items-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground" aria-label="All documents"><ArrowRight className="size-4" /></Link>} />
              <div className="px-3 pb-4">
                {docs.slice(0, 4).map((d) => (
                  <Link key={d.id} to={`/documents/${d.id}`} className="group flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors hover:bg-accent/60">
                    <div className="grid h-10 w-8 shrink-0 place-items-center rounded-[5px] border bg-background shadow-sm transition-transform duration-300 ease-spring group-hover:-rotate-3 group-hover:scale-105">
                      <span className="h-0.5 w-3.5 rounded bg-lemon" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-medium">{d.title}</p>
                      <p className="text-[12px] capitalize text-muted-foreground">{d.kind} · {timeAgo(d.updatedAt)}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </Card>
          </div>

          {activity.length > 0 && (
            <Card>
              <CardHeader title="Activity" />
              <ol className="relative mx-6 mb-5 space-y-3.5 border-l border-border/80 pl-4">
                {activity.map((a, i) => (
                  <li key={i} className="relative text-[13px]">
                    <span className={cn('absolute -left-[21px] top-1.5 size-2 rounded-full border-2 border-surface', i === 0 ? 'bg-lemon shadow-[0_0_8px_hsl(var(--lemon))]' : 'bg-muted-foreground/50')} />
                    <Link to={`/jobs/${encodeURIComponent(a.job.id)}`} className="font-medium hover:underline">{a.job.company}</Link>
                    <span className="text-muted-foreground">: {a.text}</span>
                    <p className="font-mono text-[11px] text-muted-foreground">{a.at}</p>
                  </li>
                ))}
              </ol>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
