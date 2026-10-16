import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronDown, ChevronUp, ExternalLink, Rocket } from 'lucide-react';
import { db, now } from '@/lib/db';
import { CompanyMark, Empty, Panel, StageBadge } from '@/components/common';
import { JobsHeader } from '@/components/JobsHeader';
import { Button } from '@/components/ui/button';
import { roman } from '@/lib/quest';
import type { Job } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Re-number ranks 1..n after a move so they stay dense. */
async function move(list: Job[], i: number, dir: -1 | 1) {
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  await db.transaction('rw', db.jobs, () =>
    Promise.all(next.map((job, k) => db.jobs.update(job.id, { moonshotRank: k + 1, updatedAt: now() }))),
  );
}

/** Long shots: the quests you'd most like, ranked. Each is a card with its odds. */
export default function Moonshots() {
  const list =
    useLiveQuery(async () =>
      (await db.jobs.toArray())
        .filter((j) => j.moonshot && j.stage !== 'closed')
        .sort((a, b) => (a.moonshotRank ?? 99) - (b.moonshotRank ?? 99)),
    []) ?? [];

  return (
    <>
      <JobsHeader compact sub="Long shots worth taking, ranked by how much you want them." />
      {list.length === 0 ? (
        <Empty icon={<Rocket />} title="No long shots yet">Mark a listing as a long shot from its page, or ask the guide to find some.</Empty>
      ) : (
        <div className="space-y-4">
          {list.map((j, i) => (
            <Panel key={j.id} hero={i === 0} className="rise group flex items-stretch gap-0 overflow-hidden transition-shadow duration-300 hover:shadow-lift" style={{ '--i': i } as CSSProperties}>
              <div className="flex w-14 shrink-0 flex-col items-center justify-center gap-0.5 border-r border-frame/25 bg-sunken/40 sm:w-16">
                <Button variant="ghost" size="icon" className="size-6 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100" onClick={() => move(list, i, -1)} aria-label="Move up"><ChevronUp /></Button>
                <span className={cn('font-display text-[26px] leading-none sm:text-[30px]', i < 3 ? 'text-gradient' : 'text-muted-foreground')}>{roman(i + 1)}</span>
                <Button variant="ghost" size="icon" className="size-6 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100" onClick={() => move(list, i, 1)} aria-label="Move down"><ChevronDown /></Button>
              </div>
              <Link to={`/jobs/${encodeURIComponent(j.id)}`} className="flex min-w-0 flex-1 gap-4 p-5 transition-colors hover:bg-accent/30">
                <CompanyMark job={j} size={46} className="rounded-md max-sm:hidden" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-display text-[20px] leading-tight">{j.title}</p>
                    <StageBadge stage={j.stage} />
                  </div>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">
                    {j.company} · {j.location}{j.pay ? ` · ${j.pay}` : ''}
                  </p>
                  <div className="mt-3 grid gap-x-6 gap-y-1.5 text-[13.5px] @[640px]:grid-cols-2">
                    {j.strengths?.[0] && <p><span className="mr-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-success">Shot</span>{j.strengths[0]}</p>}
                    {j.gaps?.[0] && <p><span className="mr-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-warning">Gap</span>{j.gaps[0]}</p>}
                  </div>
                </div>
              </Link>
              {j.url && (
                <a href={j.url} target="_blank" rel="noopener noreferrer" className="hidden w-12 shrink-0 place-items-center border-l border-frame/25 text-muted-foreground hover:bg-accent hover:text-foreground sm:grid" aria-label="Open posting">
                  <ExternalLink className="size-4" />
                </a>
              )}
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
