import { useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight, BookOpen, FileText, Layers, Loader2, NotebookPen, Rocket, ScrollText, Send, Sparkles } from 'lucide-react';
import { useDailyGoal, useJourney, XP } from '@/lib/quest';
import { Markdown } from '@/components/Markdown';
import { db, getProfile, moveJob, today } from '@/lib/db';
import { JobRow, Panel, PanelHeader, StageMark } from '@/components/common';
import { Signs } from '@/components/Signs';
import { Campfire, Hearts, Objective, Plate, Reward, Speech } from '@/components/game';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ask, useLive } from '@/agent/runtime';
import { isDesktop } from '@/lib/desktop';
import { needsYou, prepPrompt, readiness, upNext, wantNotice, type Readiness } from '@/lib/turnIn';
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

/** A quest's two preparations as pips: its resume, and its form filled in. */
function Pips({ resume, form }: { resume: boolean; form: Readiness }) {
  const pip = (on: boolean, half: boolean, label: string) => (
    <span title={label} className="flex items-center gap-1">
      <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
        <path d="M8 1.5L14.5 8 8 14.5 1.5 8z" fill={on ? 'hsl(var(--gold))' : half ? 'hsl(var(--gold) / 0.3)' : 'none'} stroke={on || half ? 'hsl(var(--gold))' : 'hsl(var(--frame) / 0.5)'} strokeWidth="1.5" />
      </svg>
    </span>
  );
  return (
    <span className="flex items-center gap-1">
      {pip(resume, false, resume ? 'Resume made' : 'No resume yet')}
      {pip(form === 'ready', form === 'needs-you', form === 'ready' ? 'Form filled in' : form === 'needs-you' ? 'Form filled in, with questions for you' : 'Form not filled in yet')}
    </span>
  );
}

/**
 * The turn-in table: every quest lined up, in two piles. The guide gets the
 * ones not ready yet ready (resume made, form filled in) in one go; the ready
 * ones wait for you to read through and send, one press each.
 */
function TurnInTable({ queue, docs }: { queue: Job[]; docs: Doc[] }) {
  const navigate = useNavigate();
  const live = useLive();
  const busy = !!live && !live.error;
  const [all, setAll] = useState(false);
  const hasResume = (j: Job) => docs.some((d) => d.kind === 'resume' && d.jobId === j.id);
  const prepared = queue.filter((j) => j.application);
  const ready = prepared.filter((j) => readiness(j) === 'ready');
  const todo = queue.filter((j) => !j.application);
  const shownTodo = all ? todo : todo.slice(0, 6);
  const desk = isDesktop();

  const getReady = (jobs: Job[]) => {
    wantNotice();
    ask(prepPrompt(jobs));
  };

  return (
    <Panel hero className="pop relative overflow-hidden">
      <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-[radial-gradient(closest-side,hsl(var(--gold)/0.16),transparent)]" />
      <div className="relative p-5 sm:p-7">
        <div className="flex items-center gap-2">
          <Plate className="border-gold/50 bg-gold-soft/50 text-gold-ink">Turn-in</Plate>
          <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground"><StageMark stage="next" size={11} /> {queue.length} {STAGE_LABEL.next.toLowerCase()}</span>
          <Reward xp={XP.turnedIn} label="Each" className="ml-auto" />
        </div>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="font-display text-[26px] leading-tight sm:text-[30px]">
              {ready.length ? `${ready.length} ready to submit` : prepared.length ? 'Almost ready' : 'Get them ready'}
            </p>
            <p className="mt-1 text-[13.5px] text-muted-foreground">
              {[
                prepared.length > ready.length && `${prepared.length - ready.length} with a question for you`,
                todo.length && `${todo.length} still to get ready`,
              ].filter(Boolean).join(' · ') || 'Read each one through, then send it.'}
            </p>
          </div>
          {todo.length > 0 && (
            <Button variant={ready.length ? 'outline' : 'gold'} disabled={busy} onClick={() => getReady(todo)}>
              {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {busy ? 'The guide is working…' : `Get ${todo.length === 1 ? 'it' : `all ${todo.length}`} ready to submit`}
            </Button>
          )}
        </div>

        {prepared.length > 0 && (
          <>
            <p className="eyebrow-label mt-6 px-3">Ready to submit</p>
            <ol className="well mt-2 space-y-0.5 p-1.5">
              {prepared.map((j, i) => {
                const asks = j.application!.answers.filter(needsYou).length;
                return (
                  <Objective
                    key={j.id}
                    done={false}
                    current={i === 0}
                    title={<Link to={`/turn-in/${encodeURIComponent(j.id)}`} className="hover:underline">{j.company}: {j.title}</Link>}
                    detail={
                      asks ? <span className="text-warning">{asks === 1 ? 'One question for you' : `${asks} questions for you`}</span>
                      : `${hasResume(j) ? 'Resume and ' : ''}${j.application!.answers.length} answers, ready to send`
                    }
                  >
                    <Button size="sm" variant={i === 0 ? 'gold' : 'outline'} onClick={() => navigate(`/turn-in/${encodeURIComponent(j.id)}`)}>
                      <Send /> Review
                    </Button>
                  </Objective>
                );
              })}
            </ol>
          </>
        )}

        {todo.length > 0 && (
          <>
            <p className="eyebrow-label mt-6 px-3">Getting ready</p>
            <ul className="mt-2 divide-y divide-frame/15">
              {shownTodo.map((j) => (
                <li key={j.id} className="flex items-center gap-3 px-3 py-2">
                  <Pips resume={hasResume(j)} form="none" />
                  <Link to={`/jobs/${encodeURIComponent(j.id)}`} className="min-w-0 flex-1 truncate text-[13.5px] hover:underline">
                    <span className="font-medium">{j.company}</span><span className="text-muted-foreground">: {j.title}</span>
                  </Link>
                  <Signs job={j} className="max-sm:hidden" />
                  {desk ? (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => getReady([j])}><Sparkles /> Get ready</Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => moveJob(j, 'applied')}><Send /> I sent it</Button>
                  )}
                </li>
              ))}
            </ul>
            {todo.length > shownTodo.length && (
              <button onClick={() => setAll(true)} className="ml-3 mt-1 rounded-md px-2 py-1 text-[12.5px] font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground">Show all {todo.length}</button>
            )}
          </>
        )}

        {!desk && (
          <p className="mt-4 px-1 text-[12.5px] text-muted-foreground">In the desktop app, the guide also fills in each form, so you can read it here and send it with one press.</p>
        )}
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

export default function Today() {
  const profile = useLiveQuery(() => getProfile(), []);
  const jobs = useLiveQuery(() => db.jobs.toArray(), []);
  const docs = useLiveQuery(() => db.docs.orderBy('updatedAt').reverse().toArray(), []) ?? [];
  const journey = useJourney();
  const [goal, cycleGoal] = useDailyGoal();
  const [onward, setOnward] = useState(false);
  const navigate = useNavigate();
  const list = jobs ?? [];

  const next = upNext(list);
  const [focus] = next;
  const ready = next.filter((j) => readiness(j) === 'ready').length;
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

  const line = !jobs ? '\u00a0'
    : sentToday >= goal ? `You hit today’s goal. ${momentum(counts, sentThisWeek)}`
    : ready ? `${momentum(counts, sentThisWeek)} ${ready === 1 ? 'One is' : `${ready} are`} ready for you to read through and send.`
    : focus ? `${momentum(counts, sentThisWeek)} I can get them ready while you rest.`
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
            <TurnInTable queue={next} docs={docs} />
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
        {focus && next.length < QUEUE_SIZE && candidates(list).length > 0 && (
          <Link to="/review" className="rise panel group flex items-center gap-3 px-4 py-3 text-[13.5px] transition hover:border-gold/60" style={{ '--i': 5 } as CSSProperties}>
            <Layers className="size-4 shrink-0 text-gold" />
            <span className="flex-1">Line up more quests</span>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>
        )}

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
