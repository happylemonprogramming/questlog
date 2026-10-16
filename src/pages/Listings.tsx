import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ScrollText, Search, X } from 'lucide-react';
import { db } from '@/lib/db';
import { Empty, JobRow, Panel, StageChips, type StageFilter } from '@/components/common';
import { SignChips } from '@/components/Signs';
import { JobsHeader } from '@/components/JobsHeader';
import { AddJobButton } from '@/components/AddJob';
import { Input } from '@/components/ui/input';
import { hasSign, matchesSigns, SIGNS, useSignContext, type SignId } from '@/lib/signs';
import { SHOWN_STAGES, shownStage } from '@/lib/types';

const select = 'h-10 rounded-md border border-frame/35 bg-surface px-3 text-[13.5px] transition hover:border-frame/70';

/** The log: every quest, in one list. Search it, narrow it by stage, batch or sign, and sort it. */
export default function Listings() {
  const jobs = useLiveQuery(() => db.jobs.toArray(), []) ?? [];
  const ctx = useSignContext();
  const [q, setQ] = useState('');
  const [stage, setStage] = useState<StageFilter>('all');
  const [batch, setBatch] = useState('');
  const [signs, setSigns] = useState<Set<SignId>>(() => new Set());
  const [sort, setSort] = useState<'recent' | 'pay' | 'company' | 'posted'>('recent');

  const batches = useMemo(() => [...new Set(jobs.map((j) => j.batch).filter(Boolean))] as string[], [jobs]);
  const counts = useMemo(() => Object.fromEntries(SHOWN_STAGES.map((s) => [s, jobs.filter((j) => shownStage(j.stage) === s).length])), [jobs]);

  // Everything but the sign filters, so each sign chip can say how many it would leave.
  const pool = useMemo(() => {
    const needle = q.toLowerCase();
    return jobs
      .filter((j) => (stage === 'all' ? j.stage !== 'closed' : shownStage(j.stage) === stage))
      .filter((j) => !batch || j.batch === batch)
      .filter((j) => !needle || `${j.company} ${j.title} ${j.location} ${j.batch ?? ''}`.toLowerCase().includes(needle));
  }, [jobs, q, stage, batch]);

  const signCounts = useMemo(() => {
    const out: Partial<Record<SignId, number>> = {};
    for (const id of SIGNS) {
      const others = [...signs].filter((s) => s !== id);
      out[id] = pool.filter((j) => matchesSigns(j, others, ctx) && hasSign(j, id, ctx)).length;
    }
    return out;
  }, [pool, signs, ctx]);

  const shown = useMemo(
    () =>
      pool
        .filter((j) => matchesSigns(j, signs, ctx))
        .sort((a, b) =>
          sort === 'pay' ? (b.payMax ?? b.payMin ?? 0) - (a.payMax ?? a.payMin ?? 0)
          : sort === 'company' ? a.company.localeCompare(b.company)
          : sort === 'posted' ? (b.posted ?? '').localeCompare(a.posted ?? '')
          : b.updatedAt - a.updatedAt,
        ),
    [pool, signs, ctx, sort],
  );

  const narrowed = !!q || stage !== 'all' || !!batch || signs.size > 0;
  const clear = () => {
    setQ('');
    setStage('all');
    setBatch('');
    setSigns(new Set());
  };

  return (
    <>
      <JobsHeader compact sub="Every role you're tracking.">
        <AddJobButton />
      </JobsHeader>

      <Panel className="mb-5 p-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search company, title, location…" className="h-10 pl-9 text-[14px]" />
          </div>
          {batches.length > 0 && (
            <select value={batch} onChange={(e) => setBatch(e.target.value)} className={select}>
              <option value="">All batches</option>
              {batches.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          )}
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className={select}>
            <option value="recent">Recently updated</option>
            <option value="pay">Highest pay</option>
            <option value="posted">Newest posting</option>
            <option value="company">Company A–Z</option>
          </select>
        </div>
        <StageChips value={stage} onChange={setStage} counts={counts} open={jobs.length - (counts.closed ?? 0)} className="mt-2" />
        <SignChips value={signs} onChange={setSigns} counts={signCounts} className="mt-2 px-1 pb-1" />
      </Panel>

      {shown.length ? (
        <Panel className="p-2">
          <div className="flex items-center justify-between gap-3 px-3 pb-1 pt-1.5">
            <p className="font-mono text-[11.5px] tabular-nums text-muted-foreground">
              {narrowed ? `${shown.length} of ${stage === 'all' ? jobs.length - (counts.closed ?? 0) : counts[stage] ?? 0}` : `${shown.length}`} {shown.length === 1 ? 'quest' : 'quests'}
            </p>
            {narrowed && (
              <button onClick={clear} className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px] font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground">
                <X className="size-3" /> Clear filters
              </button>
            )}
          </div>
          <div className="divide-y divide-frame/15">
            {shown.map((j, i) => <JobRow key={j.id} job={j} index={i < 16 ? i : undefined} />)}
          </div>
        </Panel>
      ) : (
        <Empty icon={<ScrollText />} title={jobs.length ? 'No quests match' : 'The log is empty'}>
          {jobs.length ? (
            <>
              Try a different filter, or{' '}
              <button onClick={clear} className="underline">clear them all</button>.
            </>
          ) : (
            'Add one by link, import your data in Settings, or ask the guide to search a company’s job board.'
          )}
        </Empty>
      )}
    </>
  );
}
