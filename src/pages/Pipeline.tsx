import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, logJob, now, today } from '@/lib/db';
import { CompanyMark, PageHeader, STAGE_DOT } from '@/components/common';
import { STAGE_LABEL, type Job, type Stage } from '@/lib/types';
import { cn } from '@/lib/utils';

const COLUMNS: Stage[] = ['saved', 'next', 'applied', 'interviewing', 'offer'];

async function moveTo(job: Job, stage: Stage) {
  if (job.stage === stage) return;
  await db.jobs.update(job.id, {
    stage,
    updatedAt: now(),
    ...(stage === 'applied' && !job.appliedAt ? { appliedAt: today(), outcome: 'in_progress' as const } : {}),
  });
  await logJob(job.id, `Moved to ${STAGE_LABEL[stage]}`);
}

export default function Pipeline() {
  const jobs = useLiveQuery(() => db.jobs.toArray(), []) ?? [];
  const [over, setOver] = useState<Stage | null>(null);

  return (
    <>
      <PageHeader eyebrow="Pipeline" title="Where everything stands" sub={<><span className="[@media(hover:none)]:hidden">Drag a card to move it.</span><span className="hidden [@media(hover:none)]:inline">Open a card to change its stage.</span> Closed roles live in Listings.</>} />
      <div className="scroll-thin -mx-2 flex snap-x snap-mandatory gap-3 overflow-x-auto px-2 pb-4 max-sm:-mx-4 max-sm:scroll-px-4 max-sm:px-4">
        {COLUMNS.map((stage) => {
          const list = jobs.filter((j) => j.stage === stage).sort((a, b) => b.updatedAt - a.updatedAt);
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
              className={cn('flex w-[248px] shrink-0 snap-start flex-col max-sm:w-[78vw] rounded-2xl bg-sunken/70 p-2 ring-1 ring-border/60 transition', over === stage && 'bg-lemon-soft/60 ring-lemon/60')}
            >
              <div className="flex items-center gap-2 px-2 pb-2 pt-1">
                <span className={cn('size-2 rounded-full', STAGE_DOT[stage])} />
                <p className="text-[13px] font-semibold">{STAGE_LABEL[stage]}</p>
                <span className="ml-auto font-mono text-[11px] text-muted-foreground">{list.length}</span>
              </div>
              <div className="flex min-h-[120px] flex-col gap-2">
                {list.map((j) => (
                  <Link
                    key={j.id}
                    to={`/jobs/${encodeURIComponent(j.id)}`}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', j.id)}
                    className="block rounded-xl border bg-surface p-3 shadow-soft transition hover:-translate-y-0.5 hover:shadow-lift"
                  >
                    <div className="flex items-center gap-2">
                      <CompanyMark name={j.company} size={24} className="rounded-md" />
                      <p className="truncate text-[12.5px] font-medium text-muted-foreground">{j.company}</p>
                    </div>
                    <p className="mt-2 line-clamp-2 text-[13.5px] font-medium leading-snug">{j.title}</p>
                    <div className="mt-2 flex items-center justify-between gap-2 text-[11.5px] text-muted-foreground">
                      <span className="truncate">{j.location}</span>
                      {j.batch && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10.5px]">{j.batch}</span>}
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
