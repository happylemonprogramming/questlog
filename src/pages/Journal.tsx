import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Award, Compass, Feather, Minus, Plus, ScrollText, Tent } from 'lucide-react';
import { Card, CardHeader, PageHeader } from '@/components/common';
import { useJourney, useWeeklyGoal, type Level } from '@/lib/quest';
import { cn } from '@/lib/utils';

function Chapter({ level }: { level: Level }) {
  const pct = Math.min(100, Math.round((level.into / level.span) * 100));
  return (
    <Card className="relative overflow-hidden p-6 sm:p-8">
      <div className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full bg-[radial-gradient(closest-side,hsl(var(--gold)/0.18),transparent)]" />
      <p className="eyebrow-label">Chapter {level.level}</p>
      <p className="mt-1 font-display text-[34px] leading-tight sm:text-[40px]">The {level.title}</p>
      <div className="mt-5 h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-gold shadow-[0_0_12px_hsl(var(--gold)/0.6)] transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 flex justify-between font-mono text-[12px] text-muted-foreground">
        <span>{level.xp} points</span>
        <span>{level.span - level.into} to chapter {level.level + 1}</span>
      </p>
    </Card>
  );
}

function WeeklyQuest({ sent }: { sent: number }) {
  const [goal, setGoal] = useWeeklyGoal();
  const done = sent >= goal;
  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:text-muted-foreground">
        <Compass />
        <h2 className="flex-1 font-display text-[19px] leading-none">This week’s quest</h2>
        <button aria-label="Lower the goal" onClick={() => setGoal(goal - 1)} className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"><Minus className="!size-3.5" /></button>
        <button aria-label="Raise the goal" onClick={() => setGoal(goal + 1)} className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"><Plus className="!size-3.5" /></button>
      </div>
      <p className="mt-3 text-[15px]">Turn in {goal} application{goal === 1 ? '' : 's'}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {Array.from({ length: goal }, (_, i) => (
          <span key={i} className={cn('h-2.5 w-6 rounded-full transition-colors duration-500', i < sent ? 'bg-gold shadow-[0_0_8px_hsl(var(--gold)/0.6)]' : 'bg-muted')} />
        ))}
      </div>
      <p className="mt-3 text-[13px] text-muted-foreground">
        {done ? `Done${sent > goal ? `, and ${sent - goal} more` : ''}. Anything else this week is a bonus.` : `${sent} so far. A week is long; there’s no rush.`}
      </p>
    </Card>
  );
}

function Run({ weeks, restedLast }: { weeks: number; restedLast: boolean }) {
  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:text-muted-foreground">
        <Tent />
        <h2 className="font-display text-[19px] leading-none">On the road</h2>
      </div>
      <p className="mt-3 font-display text-[30px] leading-none">
        {weeks} <span className="text-[16px] text-muted-foreground">week{weeks === 1 ? '' : 's'}</span>
      </p>
      <p className="mt-3 text-[13px] text-muted-foreground">
        {restedLast ? 'Last week was a rest. Your run carries on.' : 'Weeks in a row with any progress. One quiet week is a rest, not a break.'}
      </p>
    </Card>
  );
}

export default function Journal() {
  const j = useJourney();
  if (!j) return null;
  const earned = j.badges.filter((b) => b.earned).length;
  return (
    <div className="mx-auto max-w-[860px]">
      <PageHeader eyebrow="Journal" title="Your journey so far" sub="Points come from the work you put in. Replies are up to them; the effort is yours, and it counts." />

      <div className="rise space-y-6">
        <Chapter level={j.level} />

        <div className="grid gap-6 @[640px]:grid-cols-2">
          <WeeklyQuest sent={j.sentThisWeek} />
          <Run {...j.run} />
        </div>

        <Card>
          <CardHeader title="Keepsakes" icon={<Award />} count={earned} />
          <div className="grid gap-2 px-4 pb-5 @[520px]:grid-cols-2 @[780px]:grid-cols-3">
            {j.badges.map((b, i) => (
              <div
                key={b.id}
                className={cn('rise flex items-start gap-3 rounded-2xl px-3 py-3', b.earned ? 'bg-gold-soft/50 ring-1 ring-gold/40' : 'opacity-55')}
                style={{ '--i': i } as CSSProperties}
              >
                <span className={cn('mt-0.5 grid size-8 shrink-0 rotate-45 place-items-center rounded-md', b.earned ? 'bg-gold text-gold-foreground' : 'border border-dashed border-muted-foreground/50')}>
                  <span className={cn('size-2 rounded-full', b.earned ? 'bg-gold-foreground' : 'bg-muted-foreground/40')} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-medium">{b.title}</span>
                  <span className="block text-[12.5px] text-muted-foreground">{b.text}</span>
                </span>
              </div>
            ))}
          </div>
        </Card>

        {j.sent >= 5 && (
          <Card className="flex items-start gap-4 p-6">
            <Feather className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <p className="text-[14px] leading-relaxed text-muted-foreground">
              You’ve turned in {j.sent} application{j.sent === 1 ? '' : 's'}, and {j.heard} led to a conversation so far.{' '}
              Most applications never get a reply at all. That says more about how hiring works than about you, so judge the week by what you sent, not by what came back.
            </p>
          </Card>
        )}

        <Card>
          <CardHeader title="Recent deeds" icon={<ScrollText />} />
          {j.deeds.length === 0 ? (
            <p className="px-6 pb-6 text-[13.5px] text-muted-foreground">
              Nothing yet. Track a role you like, or start with <Link to="/" className="font-medium text-foreground underline-offset-2 hover:underline">today’s quest</Link>.
            </p>
          ) : (
            <ol className="relative mx-6 mb-5 space-y-3 border-l border-border/80 pl-4">
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
        </Card>
      </div>
    </div>
  );
}
