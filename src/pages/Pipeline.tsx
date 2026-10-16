import { useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, logJob, now, today } from '@/lib/db';
import { CompanyMark, STAGE_VAR, StageMark } from '@/components/common';
import { JobsHeader } from '@/components/JobsHeader';
import { STAGE_HINT, STAGE_LABEL, shownStage, type Job, type Stage } from '@/lib/types';
import { cn } from '@/lib/utils';

const COLUMNS: Stage[] = ['inbox', 'saved', 'next', 'applied'];

async function moveTo(job: Job, stage: Stage) {
  if (shownStage(job.stage) === stage) return;
  await db.jobs.update(job.id, {
    stage,
    updatedAt: now(),
    ...(stage === 'applied' && !job.appliedAt ? { appliedAt: today(), outcome: 'in_progress' as const } : {}),
  });
  await logJob(job.id, `Moved to ${STAGE_LABEL[stage]}`);
}

/** The board: one notice board per stage, quests pinned to each. Drag a quest to move it along. */
export default function Pipeline() {
  const jobs = useLiveQuery(() => db.jobs.toArray(), []) ?? [];
  const [over, setOver] = useState<Stage | null>(null);

  return (
    <>
      <JobsHeader compact sub={<>Where every quest stands. <span className="[@media(hover:none)]:hidden">Drag one to move it along.</span><span className="hidden [@media(hover:none)]:inline">Open one to change its stage.</span></>} />
      <div className="scroll-thin -mx-2 flex snap-x snap-mandatory gap-4 overflow-x-auto px-2 pb-4 pt-1 max-sm:-mx-4 max-sm:scroll-px-4 max-sm:px-4">
        {COLUMNS.map((stage) => {
          const list = jobs.filter((j) => shownStage(j.stage) === stage).sort((a, b) => b.updatedAt - a.updatedAt);
          return (
            <div
              key={stage}
              onDragOver={(e) => { e.preventDefault(); setOver(stage); }}
              onDragLeave={() => setOver(null)}
              onDrop={async (e) => {
                setOver(null);
                const job = jobs.find((j) => j.id === e.dataTransfer.getData('text/plain'));
                if (job) await moveTo(job, stage);
              }}
              className={cn(
                'panel relative flex w-[264px] shrink-0 snap-start flex-col overflow-hidden bg-sunken/40 p-2 transition-[background-color,border-color] duration-300 max-sm:w-[80vw]',
                over === stage && 'border-gold/70 bg-gold-soft/40',
              )}
            >
              {/* A thin glow along the top in the stage's color. */}
              <div className="absolute inset-x-6 top-0 h-px" style={{ background: `hsl(var(${STAGE_VAR[stage]}))`, boxShadow: `0 0 16px 1px hsl(var(${STAGE_VAR[stage]}) / 0.8)` }} />
              <div className="flex items-center gap-2 px-2.5 pb-2.5 pt-2">
                <StageMark stage={stage} size={13} />
                <p className="font-display text-[18px] leading-none tracking-wide" title={STAGE_HINT[stage]}>{STAGE_LABEL[stage]}</p>
                <span className="ml-auto rounded-[4px] bg-muted/80 px-1.5 py-px font-mono text-[11px] tabular-nums text-muted-foreground">{list.length}</span>
              </div>
              <div className="flex min-h-[120px] flex-col gap-2">
                {list.map((j, i) => (
                  <Link
                    key={j.id}
                    to={`/jobs/${encodeURIComponent(j.id)}`}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', j.id)}
                    className="cursor rise block rounded-md border border-frame/35 bg-surface p-3.5 shadow-card transition-[transform,box-shadow,border-color] duration-300 ease-out hover:-translate-y-0.5 hover:border-gold/50 hover:shadow-lift active:scale-[0.98]"
                    style={{ '--i': i } as CSSProperties}
                  >
                    <div className="flex items-center gap-2">
                      <CompanyMark job={j} size={24} className="rounded-[4px]" />
                      <p className="truncate text-[12.5px] font-medium text-muted-foreground">{j.company}</p>
                    </div>
                    <p className="mt-2 line-clamp-2 text-[13.5px] font-medium leading-snug">{j.title}</p>
                    <div className="mt-2 flex items-center justify-between gap-2 text-[11.5px] text-muted-foreground">
                      <span className="truncate">{j.location}</span>
                      {j.batch && <span className="shrink-0 rounded-[3px] bg-muted px-1.5 py-0.5 font-mono text-[10.5px]">{j.batch}</span>}
                    </div>
                    {j.steps?.length ? (
                      <div className="mt-2 flex gap-1">
                        {j.steps.map((s) => <span key={s} title={s} className="h-1 flex-1 rounded-full bg-violet/60" />)}
                      </div>
                    ) : null}
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
