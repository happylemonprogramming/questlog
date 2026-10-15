import { useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight, ArrowUpRight, CalendarClock, ChevronRight, ClipboardPen, FileText, Layers, MapPin, NotebookPen, Rocket, Send, Sparkles, Trophy, Users, Wallet } from 'lucide-react';
import { Markdown } from '@/components/Markdown';
import { db, getProfile } from '@/lib/db';
import { Card, CardHeader, CompanyMark, Empty, JobRow, shortPay } from '@/components/common';
import { AddJobButton } from '@/components/AddJob';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ask } from '@/agent/runtime';
import { useCountUp } from '@/lib/motion';
import { applicationPage, openApplication } from '@/lib/workspace';
import type { Job, Stage } from '@/lib/types';
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

const TRACK: { stage: Stage; label: string; icon: ReactNode; color: string }[] = [
  { stage: 'next', label: 'Next up', icon: <CalendarClock />, color: 'lemon' },
  { stage: 'applied', label: 'Applied', icon: <Send />, color: 'info' },
  { stage: 'interviewing', label: 'Interviewing', icon: <Users />, color: 'violet' },
  { stage: 'offer', label: 'Offers', icon: <Trophy />, color: 'success' },
];

function TrackStep({ label, icon, color, value, max, index }: { label: string; icon: ReactNode; color: string; value: number; max: number; index: number }) {
  const n = useCountUp(value);
  return (
    <Link
      to="/pipeline"
      className="rise group relative flex min-w-0 flex-col gap-3 rounded-[20px] p-3 transition-colors duration-200 hover:bg-accent/50 sm:p-4"
      style={{ '--i': index + 2 } as CSSProperties}
    >
      <div className="flex items-center gap-2">
        <span
          className="grid size-7 shrink-0 place-items-center rounded-lg transition-transform duration-300 ease-spring group-hover:scale-110 max-sm:hidden [&_svg]:size-3.5"
          style={{ background: `hsl(var(--${color}) / 0.14)`, color: `hsl(var(--${color === 'lemon' ? 'grad-a' : color}))` }}
        >
          {icon}
        </span>
        <span className="truncate text-[12.5px] font-medium text-muted-foreground sm:text-[13px]">{label}</span>
        {index < 3 && <ChevronRight className="ml-auto size-3.5 shrink-0 text-muted-foreground/40 max-sm:hidden" />}
      </div>
      <p className="text-[28px] font-semibold leading-none tracking-[-0.04em] tabular-nums sm:text-[40px]">{n}</p>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full origin-left rounded-full transition-transform duration-700 ease-out"
          style={{
            transform: `scaleX(${max ? Math.max(value / max, value ? 0.06 : 0) : 0})`,
            background: `hsl(var(--${color}))`,
            boxShadow: `0 0 12px hsl(var(--${color}) / 0.6)`,
          }}
        />
      </div>
    </Link>
  );
}

/** The first role lined up, front and center, with the way to apply right there. */
function Spotlight({ job, more }: { job: Job; more: number }) {
  const navigate = useNavigate();
  const canApply = !!applicationPage(job);
  return (
    <div className="rise relative rounded-[28px] bg-gradient-to-br from-lemon/60 via-border to-violet/50 p-px shadow-glow" style={{ '--i': 6 } as CSSProperties}>
      <div className="relative overflow-hidden rounded-[27px] bg-surface p-5 sm:p-7">
        <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-[radial-gradient(closest-side,hsl(var(--lemon)/0.14),transparent)]" />
        <p className="eyebrow-label mb-4 flex items-center gap-2 text-foreground/80">
          <Sparkles className="size-3.5 text-lemon" /> Your next move
        </p>
        <div className="flex items-start gap-4">
          <CompanyMark name={job.company} size={56} className="rounded-2xl max-sm:hidden" />
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-medium text-muted-foreground">{job.company}</p>
            <Link to={`/jobs/${encodeURIComponent(job.id)}`} className="mt-0.5 block text-[21px] font-semibold leading-tight tracking-[-0.02em] hover:underline sm:text-[24px]">
              {job.title}
            </Link>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
              {job.location && <span className="flex items-center gap-1.5"><MapPin className="size-3.5" />{job.location}</span>}
              {job.pay && !/^not listed/i.test(job.pay) && <span className="flex items-center gap-1.5 font-mono text-[12.5px]"><Wallet className="size-3.5" />{shortPay(job.pay)}</span>}
              {job.batch && <span className="flex items-center gap-1.5"><Layers className="size-3.5" />{job.batch}</span>}
            </div>
            {job.strengths?.[0] && <p className="mt-3 line-clamp-2 text-[14px] text-foreground/85">{job.strengths[0]}</p>}
          </div>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-2">
          {canApply ? (
            <Button variant="lemon" size="lg" onClick={() => openApplication(job.id)}>
              <ClipboardPen /> Apply here
            </Button>
          ) : job.url ? (
            <Button variant="lemon" size="lg" onClick={() => window.open(job.url, '_blank', 'noopener,noreferrer')}>
              <ArrowUpRight /> Open the application
            </Button>
          ) : null}
          <Button size="lg" onClick={() => navigate(`/jobs/${encodeURIComponent(job.id)}`)}>
            Open listing <ArrowRight />
          </Button>
          <Button size="lg" variant="ghost" onClick={() => ask(`Tailor my resume for ${job.company}: ${job.title}`)} className="max-sm:hidden">
            <Sparkles className="text-lemon" /> Tailor resume
          </Button>
          {more > 0 && <span className="ml-auto font-mono text-[12px] text-muted-foreground">+{more} more lined up</span>}
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
  const docs = useLiveQuery(() => db.docs.orderBy('updatedAt').reverse().limit(4).toArray(), []) ?? [];
  const list = jobs ?? [];

  const next = list.filter((j) => j.stage === 'next');
  const batches = new Map<string, Job[]>();
  for (const j of next) {
    const k = j.batch || 'Unbatched';
    batches.set(k, [...(batches.get(k) ?? []), j]);
  }
  const [spot] = [...batches.values()].flat();
  const moonshots = list.filter((j) => j.moonshot && j.stage !== 'closed').sort((a, b) => (a.moonshotRank ?? 99) - (b.moonshotRank ?? 99)).slice(0, 5);
  const activity = list
    .flatMap((j) => (j.log ?? []).map((l) => ({ ...l, job: j })))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 6);
  const counts = Object.fromEntries(TRACK.map((t) => [t.stage, list.filter((j) => j.stage === t.stage).length])) as Record<Stage, number>;
  const max = Math.max(1, ...Object.values(counts));
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const sentThisWeek = list.filter((j) => j.appliedAt && j.appliedAt >= weekAgo).length;
  const first = profile?.name?.split(' ')[0];

  let row = 0;
  const offsets = [...batches.values()].map((l) => {
    const o = row;
    row += Math.min(l.length, PER_BATCH);
    return o;
  });

  return (
    <>
      <section className="mb-9">
        <p className="eyebrow-label rise mb-4 flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-lemon shadow-[0_0_10px_hsl(var(--lemon))]" />
          {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
        <h1 className="rise text-[36px] font-semibold leading-[1.02] tracking-[-0.045em] sm:text-[52px]" style={{ '--i': 1 } as CSSProperties}>
          {greeting()},{' '}
          <span className="text-gradient">{first || 'friend'}</span>
          <span className="text-gradient">.</span>
        </h1>
        <div className="rise mt-4 flex flex-wrap items-center justify-between gap-4" style={{ '--i': 2 } as CSSProperties}>
          <p className="max-w-xl text-[15.5px] leading-relaxed text-muted-foreground sm:text-[17px]">{jobs ? momentum(counts, sentThisWeek) : '\u00a0'}</p>
          <AddJobButton variant="outline" />
        </div>
      </section>

      <div className="mb-8 grid grid-cols-4 gap-1 rounded-[24px] border border-border/70 bg-surface/70 p-1.5 shadow-card">
        {TRACK.map((t, i) => <TrackStep key={t.stage} {...t} value={counts[t.stage]} max={max} index={i} />)}
      </div>

      {spot && (
        <div className="mb-8">
          <Spotlight job={spot} more={next.length - 1} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 @[880px]:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader title="Lined up" icon={<CalendarClock />} count={next.length} action={<Link to="/listings" className="text-[12.5px] font-medium text-muted-foreground transition hover:text-foreground">All listings</Link>} />
          <div className="px-3 pb-4">
            {next.length === 0 ? (
              <div className="p-3"><Empty icon={<CalendarClock />} title="Nothing lined up yet">Open a listing and set its stage to Next up, or ask the assistant what to apply to.</Empty></div>
            ) : (
              [...batches].map(([batch, l], i) => <Batch key={batch} name={batch} list={l} offset={offsets[i]} />)
            )}
          </div>
        </Card>

        <div className="space-y-6">
          {profile?.notes?.trim() && (
            <Card>
              <CardHeader title="Working notes" icon={<NotebookPen />} action={<Link to="/settings" className="text-[12.5px] text-muted-foreground hover:text-foreground">Edit</Link>} />
              <div className="scroll-thin max-h-[340px] overflow-y-auto px-6 pb-5">
                <Markdown text={profile.notes} />
              </div>
            </Card>
          )}
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
              {docs.map((d) => (
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
      </div>
    </>
  );
}
