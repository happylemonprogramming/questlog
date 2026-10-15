import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { LayoutList, Search } from 'lucide-react';
import { db } from '@/lib/db';
import { Card, Empty, JobRow, PageHeader, STAGE_DOT } from '@/components/common';
import { AddJobButton } from '@/components/AddJob';
import { Input } from '@/components/ui/input';
import { STAGES, STAGE_LABEL, type Stage } from '@/lib/types';
import { cn } from '@/lib/utils';

type Filter = Stage | 'all';

export default function Listings() {
  const jobs = useLiveQuery(() => db.jobs.toArray(), []) ?? [];
  const [q, setQ] = useState('');
  const [stage, setStage] = useState<Filter>('all');
  const [batch, setBatch] = useState('');
  const [sort, setSort] = useState<'recent' | 'pay' | 'company'>('recent');

  const batches = useMemo(() => [...new Set(jobs.map((j) => j.batch).filter(Boolean))] as string[], [jobs]);
  const counts = useMemo(() => Object.fromEntries(STAGES.map((s) => [s, jobs.filter((j) => j.stage === s).length])), [jobs]);

  const shown = useMemo(() => {
    const needle = q.toLowerCase();
    return jobs
      .filter((j) => (stage === 'all' ? j.stage !== 'closed' : j.stage === stage))
      .filter((j) => !batch || j.batch === batch)
      .filter((j) => !needle || `${j.company} ${j.title} ${j.location} ${j.batch ?? ''}`.toLowerCase().includes(needle))
      .sort((a, b) =>
        sort === 'pay' ? (b.payMax ?? 0) - (a.payMax ?? 0) : sort === 'company' ? a.company.localeCompare(b.company) : b.updatedAt - a.updatedAt,
      );
  }, [jobs, q, stage, batch, sort]);

  const chips: Filter[] = ['all', ...STAGES];

  return (
    <>
      <PageHeader eyebrow="Listings" title="Every role you're tracking" sub={`${jobs.filter((j) => j.stage !== 'closed').length} open, ${counts.closed ?? 0} closed`}>
        <AddJobButton />
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search company, title, location…" className="pl-9" />
        </div>
        {batches.length > 0 && (
          <select value={batch} onChange={(e) => setBatch(e.target.value)} className="h-9 rounded-lg border border-input bg-surface px-3 text-sm">
            <option value="">All batches</option>
            {batches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        )}
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="h-9 rounded-lg border border-input bg-surface px-3 text-sm">
          <option value="recent">Recently updated</option>
          <option value="pay">Highest pay</option>
          <option value="company">Company A–Z</option>
        </select>
      </div>

      <div className="scroll-thin mb-5 flex gap-1 overflow-x-auto pb-1">
        {chips.map((c) => (
          <button
            key={c}
            onClick={() => setStage(c)}
            className={cn(
              'flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition',
              stage === c ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {c !== 'all' && <span className={cn('size-1.5 rounded-full', STAGE_DOT[c])} />}
            {c === 'all' ? 'Open' : STAGE_LABEL[c]}
            <span className="font-mono text-[11px] opacity-60">{c === 'all' ? jobs.length - (counts.closed ?? 0) : counts[c]}</span>
          </button>
        ))}
      </div>

      {shown.length ? (
        <Card className="p-2">
          <div className="divide-y divide-border/60">
            {shown.map((j) => <JobRow key={j.id} job={j} />)}
          </div>
        </Card>
      ) : (
        <Empty icon={<LayoutList />} title={jobs.length ? 'No listings match' : 'No listings yet'}>
          {jobs.length ? 'Try a different filter.' : 'Add one by link, import your data in Settings, or ask the assistant to search a company’s job board.'}
        </Empty>
      )}
    </>
  );
}
