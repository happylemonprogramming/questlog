import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Award, Compass, Feather, Minus, Plus, ScrollText, Tent } from 'lucide-react';
import { PageHeader, Panel, PanelHeader } from '@/components/common';
import { Ring, XpBar } from '@/components/game';
import { roman, useJourney, useWeeklyGoal, type Level } from '@/lib/quest';
import { cn } from '@/lib/utils';

function Chapter({ level }: { level: Level }) {
  return (
    <Panel hero className="relative overflow-hidden p-6 sm:p-8">
      <div className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full bg-[radial-gradient(closest-side,hsl(var(--gold)/0.2),transparent)]" />
      <p className="eyebrow-label">Chapter {roman(level.level)}</p>
      <p className="mt-1 font-display text-[38px] leading-tight sm:text-[46px]">The {level.title}</p>
      <XpBar into={level.into} span={level.span} className="mt-5 h-2" />
      <p className="mt-2 flex justify-between font-mono text-[12px] text-muted-foreground">
        <span>{level.xp} points</span>
        <span>{level.span - level.into} to chapter {roman(level.level + 1)}</span>
      </p>
    </Panel>
  );
}

function WeeklyQuest({ sent }: { sent: number }) {
  const [goal, setGoal] = useWeeklyGoal();
  const done = sent >= goal;
  return (
    <Panel className="p-6">
      <div className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:text-gold">
        <Compass />
        <h2 className="flex-1 font-display text-[20px] leading-none">This week’s quest</h2>
        <button aria-label="Lower the goal" onClick={() => setGoal(goal - 1)} className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><Minus className="!size-3.5" /></button>
        <button aria-label="Raise the goal" onClick={() => setGoal(goal + 1)} className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><Plus className="!size-3.5" /></button>
      </div>
      <div className="mt-4 flex items-center gap-4">
        <Ring value={sent} max={goal} size={56} stroke={5}>
          <span className="font-display text-[18px] leading-none">{Math.min(sent, goal)}</span>
        </Ring>
        <div>
          <p className="text-[15px]">Turn in {goal} application{goal === 1 ? '' : 's'}</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {done ? `Done${sent > goal ? `, and ${sent - goal} more` : ''}. Anything else this week is a bonus.` : `${sent} so far. A week is long; there’s no rush.`}
          </p>
        </div>
      </div>
    </Panel>
  );
}

function Run({ weeks, restedLast }: { weeks: number; restedLast: boolean }) {
  return (
    <Panel className="p-6">
      <div className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:text-gold">
        <Tent />
        <h2 className="font-display text-[20px] leading-none">On the road</h2>
      </div>
      <p className="mt-3 font-display text-[34px] leading-none">
        {weeks} <span className="text-[16px] text-muted-foreground">week{weeks === 1 ? '' : 's'}</span>
      </p>
      <p className="mt-3 text-[13px] text-muted-foreground">
        {restedLast ? 'Last week was a rest. Your run carries on.' : 'Weeks in a row with any progress. One quiet week is a rest, not a break.'}
      </p>
    </Panel>
  );
}

/** A keepsake: a medallion, lit once earned. */
function Medallion({ earned }: { earned: boolean }) {
  return (
    <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true" className="shrink-0">
      <path d="M20 2l5 4.5 6.6-.6 1.4 6.5 5.8 3.2-2.8 6 2.8 6-5.8 3.2-1.4 6.5-6.6-.6L20 41l-5-4.5-6.6.6-1.4-6.5-5.8-3.2 2.8-6-2.8-6 5.8-3.2 1.4-6.5 6.6.6z"
        fill={earned ? 'hsl(var(--gold))' : 'hsl(var(--frame) / 0.08)'} stroke={earned ? 'hsl(var(--gold-ink))' : 'hsl(var(--frame) / 0.45)'} strokeWidth="1" strokeDasharray={earned ? undefined : '2 2'} />
      <circle cx="20" cy="20" r="9" fill="none" stroke={earned ? 'hsl(var(--gold-foreground) / 0.5)' : 'hsl(var(--frame) / 0.35)'} strokeWidth="1.2" />
      <path d="M20 14l1.8 3.7 4 .6-2.9 2.8.7 4L20 23.2l-3.6 1.9.7-4-2.9-2.8 4-.6z" fill={earned ? 'hsl(var(--gold-foreground))' : 'hsl(var(--frame) / 0.3)'} />
    </svg>
  );
}

export default function Journal() {
  const j = useJourney();
  if (!j) return null;
  const earned = j.badges.filter((b) => b.earned).length;
  return (
    <div className="mx-auto max-w-[860px]">
      <PageHeader title="Your journey so far" sub="Points come from the work you put in. Replies are up to them; the effort is yours, and it counts." />

      <div className="rise space-y-6">
        <Chapter level={j.level} />

        <div className="grid gap-6 @[640px]:grid-cols-2">
          <WeeklyQuest sent={j.sentThisWeek} />
          <Run {...j.run} />
        </div>

        <Panel>
          <PanelHeader title="Keepsakes" icon={<Award />} count={earned} />
          <div className="grid gap-2 px-4 pb-5 @[520px]:grid-cols-2 @[780px]:grid-cols-3">
            {j.badges.map((b, i) => (
              <div
                key={b.id}
                className={cn('rise flex items-start gap-3 rounded-md px-3 py-3', b.earned ? 'bg-gold-soft/45 ring-1 ring-gold/40' : 'opacity-60')}
                style={{ '--i': i } as CSSProperties}
              >
                <Medallion earned={b.earned} />
                <span className="min-w-0">
                  <span className="block font-display text-[17px] leading-tight">{b.title}</span>
                  <span className="block text-[12.5px] text-muted-foreground">{b.text}</span>
                </span>
              </div>
            ))}
          </div>
        </Panel>

        {j.sent >= 5 && (
          <Panel className="flex items-start gap-4 p-6">
            <Feather className="mt-0.5 size-5 shrink-0 text-gold" />
            <p className="text-[14px] leading-relaxed text-muted-foreground">
              You’ve turned in {j.sent} application{j.sent === 1 ? '' : 's'}, and {j.heard} led to a conversation so far.{' '}
              Most applications never get a reply at all. That says more about how hiring works than about you, so judge the week by what you sent, not by what came back.
            </p>
          </Panel>
        )}

        <Panel>
          <PanelHeader title="Deeds" icon={<ScrollText />} />
          {j.deeds.length === 0 ? (
            <p className="px-6 pb-6 text-[13.5px] text-muted-foreground">
              Nothing yet. Track a role you like, or start with <Link to="/" className="font-medium text-foreground underline-offset-2 hover:underline">the active quest at camp</Link>.
            </p>
          ) : (
            <ol className="relative mx-6 mb-5 space-y-3 border-l border-frame/30 pl-4">
              {j.deeds.slice(0, 25).map((d, i) => (
                <li key={i} className="relative flex items-baseline gap-3 text-[13.5px]">
                  <span className={cn('absolute -left-[21px] top-1.5 size-2 rotate-45 border-2 border-surface', i === 0 ? 'bg-gold' : 'bg-muted-foreground/50')} />
                  <span className="min-w-0 flex-1">
                    {d.jobId ? <Link to={`/jobs/${encodeURIComponent(d.jobId)}`} className="hover:underline">{d.text}</Link> : d.text}
                    <span className="block font-mono text-[11px] text-muted-foreground">{d.at}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[12px] text-gold-ink">+{d.xp}</span>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
    </div>
  );
}
