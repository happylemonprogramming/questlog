import { useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight, ArrowUpRight, BookOpen, ClipboardPen, FileText, Layers, MapPin, NotebookPen, Rocket, ScrollText, Send, Sparkles, Wallet } from 'lucide-react';
import { useDailyGoal, useJourney, XP } from '@/lib/quest';
import { Markdown } from '@/components/Markdown';
import { db, getProfile, moveJob, today } from '@/lib/db';
import { JobRow, Panel, PanelHeader, shortPay, StageMark } from '@/components/common';
import { Signs } from '@/components/Signs';
import { Campfire, Hearts, Objective, Plate, Reward, Speech } from '@/components/game';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ask } from '@/agent/runtime';
import { applicationPage, openApplication } from '@/lib/workspace';
import { candidates, QUEUE_SIZE } from '@/lib/queue';
import { STAGE_LABEL, type Doc, type Job, type Stage } from '@/lib/types';
import { cn, timeAgo } from '@/lib/utils';

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** What the guide says about where things stand, leading with the best news. */
function momentum(c: Record<Stage, number>, sentThisWeek: number) {
  const week = sentThisWeek ? ` ${sentThisWeek} sent this week.` : '';
  if (c.offer) return `${c.offer === 1 ? 'An offer is' : `${c.offer} offers are`} on the table.${week}`;
  if (c.interviewing) return `${c.interviewing} interview${c.interviewing === 1 ? '' : 's'} in motion and ${c.next} more lined up.${week}`;
  if (c.applied) return `${c.applied} application${c.applied === 1 ? '' : 's'} out and ${c.next} lined up.${week}`;
  if (c.next) return `${c.next} role${c.next === 1 ? '' : 's'} lined up. A good day to send the first one.`;
  return 'Add a listing, or ask me to search a job board, and we’ll start the first quest.';
}

const PROGRESS_KEY = 'questlog:progress';

type Progress = Record<string, { resume?: boolean; opened?: boolean }>;

/** Steps done outside the data: chose to use a resume made elsewhere, opened the form. Kept on this device. */
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

/** The active quest: the one application to work on now, as three objectives. */
function ActiveQuest({ job, resume, baseOk, opened, onMark }: { job: Job; resume?: Doc; baseOk: boolean; opened: boolean; onMark: (step: 'resume' | 'opened') => void }) {
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
    <Panel hero key={job.id} className="pop relative overflow-hidden">
      <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-[radial-gradient(closest-side,hsl(var(--gold)/0.16),transparent)]" />
      <div className="relative p-5 sm:p-7">
        <div className="flex items-center gap-2">
          <Plate className="border-gold/50 bg-gold-soft/50 text-gold-ink">Active quest</Plate>
          <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground"><StageMark stage="next" size={11} /> {STAGE_LABEL.next}</span>
          <Reward xp={XP.turnedIn} className="ml-auto" />
        </div>
        <div className="mt-5 min-w-0">
          <p className="text-[13.5px] font-medium text-muted-foreground">{job.company}</p>
          <Link to={`/jobs/${encodeURIComponent(job.id)}`} className="mt-0.5 block font-display text-[26px] leading-tight hover:underline sm:text-[30px]">
            {job.title}
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
            {job.location && <span className="flex items-center gap-1.5"><MapPin className="size-3.5" />{job.location}</span>}
            {job.pay && !/^not listed/i.test(job.pay) && <span className="flex items-center gap-1.5 font-mono text-[12.5px]"><Wallet className="size-3.5" />{shortPay(job.pay)}</span>}
          </div>
          <Signs job={job} labels className="mt-3" />
        </div>

        <p className="eyebrow-label mt-6 px-3">Objectives</p>
        <ol className="well mt-2 space-y-0.5 p-1.5">
          <Objective done={ready} current={step === 1} title="Make your resume" detail={resume ? resume.title : baseOk ? 'Using one you already have' : 'Written and designed for this role'}>
            {resume ? (
              <Button size="sm" variant="ghost" onClick={() => navigate(`/documents/${resume.id}`)}>View</Button>
            ) : baseOk ? null : (
              <>
                <Button size="sm" variant="ghost" onClick={() => onMark('resume')} className="text-muted-foreground">I have one</Button>
                <Button size="sm" variant={step === 1 ? 'gold' : 'outline'} onClick={() => ask(`Make my resume for ${job.company}: ${job.title} (listing ${job.id}), written from my career record and designed for this company.`)}>
                  <Sparkles /> Make it
                </Button>
              </>
            )}
          </Objective>
          <Objective done={opened} current={step === 2} title="Fill in the application" detail={inApp ? 'Opens here, next to your answers' : 'Opens the company’s site in a new tab'}>
            {(inApp || job.url) && (
              <Button size="sm" variant={step === 2 ? 'gold' : 'outline'} onClick={open}>
                {inApp ? <ClipboardPen /> : <ArrowUpRight />} Open it
              </Button>
            )}
          </Objective>
          <Objective done={false} current={step === 3} title="Turn it in" detail="Press submit on their form, then mark it here">
            <Button size="sm" variant={step === 3 ? 'gold' : 'outline'} onClick={() => moveJob(job, 'applied')}>
              <Send /> I sent it
            </Button>
          </Objective>
        </ol>

        <div className="mt-4 flex items-center justify-between gap-3 px-1 text-[13px]">
          <Link to={`/jobs/${encodeURIComponent(job.id)}`} className="font-medium text-muted-foreground transition hover:text-foreground">Read the listing</Link>
          <button onClick={() => moveJob(job, 'saved', 'Set aside at camp')} className="font-medium text-muted-foreground transition hover:text-foreground">Not now</button>
        </div>
      </div>
    </Panel>
  );
}

/** The day's goal is met: a fire, a tally, and a clear place to stop. */
function RestAtCamp({ sent, onContinue, more, xp, deeds }: { sent: number; onContinue: () => void; more: boolean; xp: number; deeds: { text: string; xp: number }[] }) {
  return (
    <Panel hero className="pop relative overflow-hidden text-center">
      <div className="pointer-events-none absolute inset-x-0 -bottom-24 mx-auto size-80 rounded-full bg-[radial-gradient(closest-side,hsl(var(--gold)/0.25),transparent)]" />
      <div className="relative p-7 sm:p-9">
        <Campfire className="mx-auto size-16" />
        <p className="mt-3 font-display text-[30px] sm:text-[36px]">Today’s quest is done</p>
        <p className="mx-auto mt-2 max-w-md text-[14.5px] leading-relaxed text-muted-foreground">
          You turned in {sent} application{sent === 1 ? '' : 's'} today{xp ? `, and earned ${xp} points` : ''}. Rest at camp. The road will still be here tomorrow.
        </p>
        {deeds.length > 0 && (
          <ul className="well mx-auto mt-5 max-w-sm space-y-1 p-3 text-left text-[13px]">
            {deeds.slice(0, 5).map((d, i) => (
              <li key={i} className="flex gap-3"><span className="flex-1 truncate">{d.text}</span><span className="font-mono text-gold-ink">+{d.xp}</span></li>
            ))}
          </ul>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link to="/journal" className="inline-flex h-9 items-center gap-2 rounded-md px-4 text-[13.5px] font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"><BookOpen className="size-4" /> Open your journal</Link>
          {more && <Button variant="outline" onClick={onContinue}>Keep going anyway</Button>}
        </div>
      </div>
    </Panel>
  );
}

const PER_BATCH = 5;

function Batch({ name, list, offset, activeId }: { name: string; list: Job[]; offset: number; activeId?: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? list : list.slice(0, PER_BATCH);
  return (
    <div className="mt-3 first:mt-0">
      <div className="flex items-center gap-2 px-3 pb-1.5 pt-2">
        <Layers className="size-3.5 text-muted-foreground" />
        <p className="eyebrow-label">{name}</p>
        <span className="h-px flex-1 bg-frame/20" />
        <span className="font-mono text-[11px] text-muted-foreground">{list.length}</span>
      </div>
      {shown.map((j, i) => <JobRow key={j.id} job={j} compact actions={false} right={<span />} index={offset + i} selected={j.id === activeId} />)}
      {list.length > PER_BATCH && (
        <button onClick={() => setAll((a) => !a)} className="ml-3 mt-1 rounded-md px-2 py-1 text-[12.5px] font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground">
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
  const journey = useJourney();
  const [goal, cycleGoal] = useDailyGoal();
  const [progress, mark] = useProgress();
  const [onward, setOnward] = useState(false);
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
  const sentToday = list.filter((j) => j.appliedAt === today()).length;
  const sentThisWeek = journey?.sentThisWeek ?? 0;
  const first = profile?.name?.split(' ')[0];
  const todays = journey?.deeds.filter((d) => d.at === today()) ?? [];

  let row = 0;
  const offsets = [...batches.values()].map((l) => {
    const o = row;
    row += Math.min(l.length, PER_BATCH);
    return o;
  });

  const line = !jobs ? '\u00a0'
    : sentToday >= goal ? `You hit today’s goal. ${momentum(counts, sentThisWeek)}`
    : focus ? `${momentum(counts, sentThisWeek)} One quest at a time; here’s the next one.`
    : momentum(counts, sentThisWeek);

  return (
    <div className="grid gap-7 @[900px]:grid-cols-[minmax(0,1fr)_300px] @[900px]:gap-8">
      <div className="min-w-0">
        <section className="mb-6">
          <p className="eyebrow-label rise mb-3 flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-gold shadow-[0_0_10px_hsl(var(--gold))]" />
            {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
          <h1 className="rise font-display text-[38px] leading-[1.02] sm:text-[50px]" style={{ '--i': 1 } as CSSProperties}>
            {greeting()},{' '}
            <span className="text-gradient">{first || 'traveler'}</span>
            <span className="text-gradient">.</span>
          </h1>
          <Speech className="rise mt-6" style={{ '--i': 2 } as CSSProperties} more={!!focus && sentToday < goal}>
            <p>{line}</p>
          </Speech>
          {focus && (
            <div className="rise mt-4 flex flex-wrap items-center gap-3 px-1" style={{ '--i': 3 } as CSSProperties}>
              <Hearts filled={sentToday} total={goal} size={18} onClick={cycleGoal} title="Change today's goal" />
              <span className="text-[13px] text-muted-foreground">{Math.min(sentToday, goal)} of {goal} turned in today</span>
            </div>
          )}
        </section>

        {next.length > QUEUE_SIZE && (
          <Link to="/review" className="rise panel group mb-4 flex items-center gap-3 px-4 py-3 text-[14px] transition hover:border-gold/60" style={{ '--i': 4 } as CSSProperties}>
            <Layers className="size-4 shrink-0 text-gold" />
            <span className="flex-1"><span className="font-medium">{next.length} quests are lined up.</span> <span className="text-muted-foreground">That’s a lot to carry. Choose your top {QUEUE_SIZE}?</span></span>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>
        )}

        <div className="rise" style={{ '--i': 4 } as CSSProperties}>
          {jobs && sentToday >= goal && !onward ? (
            <RestAtCamp sent={sentToday} more={!!focus} onContinue={() => setOnward(true)} xp={journey?.xpToday ?? 0} deeds={todays} />
          ) : focus ? (
            <ActiveQuest job={focus} resume={resume} baseOk={!!progress[focus.id]?.resume} opened={!!progress[focus.id]?.opened} onMark={(step) => mark(focus.id, step)} />
          ) : jobs ? (
            <Panel className="p-8 text-center">
              <div className="mx-auto mb-4 grid size-12 rotate-45 place-items-center rounded-md border border-gold/50 bg-gold-soft/40 text-gold-ink [&_svg]:size-5 [&_svg]:-rotate-45">
                <ScrollText />
              </div>
              <p className="font-display text-[24px]">No active quest</p>
              <p className="mx-auto mt-1 max-w-sm text-[14px] text-muted-foreground">Choose a few roles you’d like to send next, or ask the guide to find some.</p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {candidates(list).length > 0 && <Button variant="gold" onClick={() => navigate('/review')}><Layers /> Choose from your tracked roles</Button>}
                <Button variant={candidates(list).length ? 'outline' : 'gold'} onClick={() => ask(`What should I apply to next? Pick up to ${QUEUE_SIZE} and line them up.`)}><Sparkles /> Ask the guide</Button>
              </div>
            </Panel>
          ) : null}
        </div>

        {profile?.notes?.trim() && (
          <Panel className="rise mt-7" style={{ '--i': 6 } as CSSProperties}>
            <PanelHeader title="Working notes" icon={<NotebookPen />} action={<Link to="/settings" className="text-[12.5px] text-muted-foreground hover:text-foreground">Edit</Link>} />
            <div className="scroll-thin max-h-[340px] overflow-y-auto px-6 pb-5">
              <Markdown text={profile.notes} />
            </div>
          </Panel>
        )}
      </div>

      <aside className="min-w-0 space-y-5 @[900px]:pt-1">
        <Panel className="rise" style={{ '--i': 5 } as CSSProperties}>
          <PanelHeader title="Quest board" icon={<ScrollText />} count={next.length} action={<Link to="/listings" className="text-[12.5px] font-medium text-muted-foreground transition hover:text-foreground">All quests</Link>} />
          <div className="px-2 pb-3">
            {next.length === 0 ? (
              <p className="px-3 py-3 text-[13px] text-muted-foreground">Nothing lined up. Open a listing and set it to Up next, or ask the guide.</p>
            ) : (
              [...batches].map(([batch, l], i) => <Batch key={batch} name={batch} list={l} offset={offsets[i]} activeId={focus?.id} />)
            )}
            {focus && next.length < QUEUE_SIZE && candidates(list).length > 0 && (
              <Link to="/review" className="mt-1 flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground">
                <Layers className="size-3.5" /> Line up more
              </Link>
            )}
          </div>
        </Panel>

        <Panel className="rise" style={{ '--i': 6 } as CSSProperties}>
          <PanelHeader title="Long shots" icon={<Rocket />} action={<Link to="/moonshots" className="grid size-7 place-items-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground" aria-label="All long shots"><ArrowRight className="size-4" /></Link>} />
          <div className="px-2 pb-3">
            {moonshots.length ? moonshots.map((j, i) => (
              <JobRow key={j.id} job={j} compact actions={false} right={j.stage === 'applied' ? <Badge tone="info">{STAGE_LABEL.applied}</Badge> : <span />} rank={<span className="w-4 text-center font-mono text-[12px] text-muted-foreground">{i + 1}</span>} />
            )) : <p className="px-3 py-3 text-[13px] text-muted-foreground">Long shots worth a try will show up here.</p>}
          </div>
        </Panel>

        <Panel className="rise" style={{ '--i': 7 } as CSSProperties}>
          <PanelHeader title="Recent scrolls" icon={<FileText />} action={<Link to="/documents" className="grid size-7 place-items-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground" aria-label="All documents"><ArrowRight className="size-4" /></Link>} />
          <div className="px-2 pb-3">
            {docs.slice(0, 4).map((d) => (
              <Link key={d.id} to={`/documents/${d.id}`} className="cursor group flex items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-accent/60">
                <div className="grid h-9 w-7 shrink-0 place-items-center rounded-[3px] border border-frame/40 bg-background shadow-sm transition-transform duration-300 ease-spring group-hover:-rotate-3 group-hover:scale-105">
                  <span className="h-0.5 w-3 rounded bg-gold" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium">{d.title}</p>
                  <p className="text-[11.5px] capitalize text-muted-foreground">{d.kind} · {timeAgo(d.updatedAt)}</p>
                </div>
              </Link>
            ))}
            {docs.length === 0 && <p className="px-3 py-3 text-[13px] text-muted-foreground">Resumes and letters you write will show up here.</p>}
          </div>
        </Panel>

        {activity.length > 0 && (
          <Panel className="rise" style={{ '--i': 8 } as CSSProperties}>
            <PanelHeader title="Chronicle" icon={<BookOpen />} />
            <ol className="relative mx-6 mb-5 space-y-3 border-l border-frame/30 pl-4">
              {activity.map((a, i) => (
                <li key={i} className="relative text-[13px]">
                  <span className={cn('absolute -left-[21px] top-1.5 size-2 rotate-45 border border-surface', i === 0 ? 'bg-gold shadow-[0_0_8px_hsl(var(--gold))]' : 'bg-muted-foreground/50')} />
                  <Link to={`/jobs/${encodeURIComponent(a.job.id)}`} className="font-medium hover:underline">{a.job.company}</Link>
                  <span className="text-muted-foreground">: {a.text}</span>
                  <p className="font-mono text-[11px] text-muted-foreground">{a.at}</p>
                </li>
              ))}
            </ol>
          </Panel>
        )}
      </aside>
    </div>
  );
}
