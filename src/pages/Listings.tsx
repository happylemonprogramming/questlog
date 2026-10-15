import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { LayoutList, Search } from 'lucide-react';
import { db } from '@/lib/db';
import { Card, Empty, JobRow, PageHeader, StageChips, type StageFilter } from '@/components/common';
import { AddJobButton } from '@/components/AddJob';
import { Input } from '@/components/ui/input';
import { STAGES } from '@/lib/types';


export default function Listings() {
  const jobs = useLiveQuery(() => db.jobs.toArray(), []) ?? [];
  const [q, setQ] = useState('');
  const [stage, setStage] = useState<StageFilter>('all');
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


  return (
    <>
      <PageHeader eyebrow="Listings" title="Every role you're tracking" sub={`${jobs.filter((j) => j.stage !== 'closed').length} open, ${counts.closed ?? 0} closed`}>
        <AddJobButton />
      </PageHeader>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search company, title, location…" className="h-11 rounded-xl pl-10 text-[14.5px]" />
        </div>
        {batches.length > 0 && (
          <select value={batch} onChange={(e) => setBatch(e.target.value)} className="h-11 rounded-xl border border-input/80 bg-surface px-3.5 text-[14px] transition hover:border-foreground/20">
            <option value="">All batches</option>
            {batches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        )}
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="h-11 rounded-xl border border-input/80 bg-surface px-3.5 text-[14px] transition hover:border-foreground/20">
          <option value="recent">Recently updated</option>
          <option value="pay">Highest pay</option>
          <option value="company">Company A–Z</option>
        </select>
      </div>

      <StageChips value={stage} onChange={setStage} counts={counts} open={jobs.length - (counts.closed ?? 0)} />

      {shown.length ? (
        <Card className="p-2">
          <div className="divide-y divide-border/40">
            {shown.map((j, i) => <JobRow key={j.id} job={j} index={i < 16 ? i : undefined} />)}
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
