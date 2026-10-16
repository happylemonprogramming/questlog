import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { FileText, Plus, Star } from 'lucide-react';
import { db, now, uid } from '@/lib/db';
import { Empty, PageHeader } from '@/components/common';
import { Sources } from '@/components/Sources';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { DocSheet, ScaledSheet } from '@/components/Sheet';
import { Button } from '@/components/ui/button';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { SAMPLE_RESUME, sampleLetter } from '@/lib/sheet';
import { useSlidingHighlight } from '@/lib/motion';
import type { AnswerData, Doc, DocKind, Job } from '@/lib/types';
import { cn, timeAgo } from '@/lib/utils';
import { useMedia } from '@/lib/useMedia';
import { useNavigate } from 'react-router-dom';

type Tab = DocKind | 'all' | 'sources';

const TABS: [Tab, string][] = [
  ['all', 'All'],
  ['resume', 'Resumes'],
  ['letter', 'Cover letters'],
  ['answer', 'Answers'],
  ['sources', 'Sources'],
];

export function DocThumb({ doc, width = 212 }: { doc: Doc; width?: number }) {
  if (doc.kind === 'answer') {
    const a = doc.data as AnswerData;
    return (
      <div style={{ width, height: width * 1.294 }} className="overflow-hidden bg-surface p-4 text-left">
        {a.prompt && <p className="eyebrow-label mb-2 line-clamp-2 normal-case tracking-normal">{a.prompt}</p>}
        <p className="line-clamp-[12] text-[12px] leading-relaxed text-foreground/80">{a.text}</p>
      </div>
    );
  }
  return (
    <div style={{ width, height: width * 1.294 }} className="pointer-events-none overflow-hidden">
      <ScaledSheet width={width}>
        <ErrorBoundary compact resetKey={doc.updatedAt}>
          <DocSheet doc={doc} />
        </ErrorBoundary>
      </ScaledSheet>
    </div>
  );
}

/** A document as a card on the table: the page itself, framed, the cursor on it when pointed at. */
function DocCard({ doc, job, width }: { doc: Doc; job?: Job; width: number }) {
  const navigate = useNavigate();
  const open = () => navigate(`/documents/${doc.id}`);
  return (
    <div role="link" tabIndex={0} onClick={open} onKeyDown={(e) => e.key === 'Enter' && open()} style={{ width }} className="group block cursor-pointer rounded-md focus-visible:outline-none">
      <div className="cursor relative overflow-hidden rounded-[4px] border border-frame/40 bg-sunken shadow-soft transition duration-300 ease-spring group-hover:-translate-y-1 group-hover:-rotate-1 group-hover:shadow-lift group-focus-visible:[&::after]:opacity-100">
        <DocThumb doc={doc} width={width} />
      </div>
      <div className="mt-3 px-0.5">
        <p className="flex items-center gap-1.5 truncate font-display text-[16px] leading-tight">
          {doc.base && <Star className="size-3.5 shrink-0 fill-gold text-gold" aria-label="Base" />}
          {doc.title}
        </p>
        <p className="truncate text-[12px] text-muted-foreground">
          {job ? job.company : <span className="capitalize">{doc.kind}</span>}
          {doc.variant ? ` · ${doc.variant}` : ''} · {timeAgo(doc.updatedAt)}
        </p>
      </div>
    </div>
  );
}

export default function Documents() {
  const [tab, setTab] = useState<Tab>('all');
  const fileCount = useLiveQuery(() => db.files.count(), []) ?? 0;
  const docs = useLiveQuery(() => db.docs.orderBy('updatedAt').reverse().toArray(), []) ?? [];
  const jobs = useLiveQuery(() => db.jobs.toArray(), []) ?? [];
  const navigate = useNavigate();
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const shown = docs.filter((d) => tab === 'all' || d.kind === tab);
  const { container, highlight } = useSlidingHighlight<HTMLDivElement, HTMLSpanElement>('[aria-pressed="true"]', tab);
  async function create(kind: DocKind) {
    const data = kind === 'resume' ? SAMPLE_RESUME : kind === 'letter' ? sampleLetter(SAMPLE_RESUME.header) : ({ text: '' } satisfies AnswerData);
    const id = uid();
    await db.docs.add({ id, kind, title: kind === 'resume' ? 'Untitled resume' : kind === 'letter' ? 'Untitled letter' : 'Untitled answer', data, createdAt: now(), updatedAt: now() });
    navigate(`/documents/${id}`);
  }

  // Two across on a phone.
  const narrow = useMedia('(max-width: 639px)');
  const card = narrow ? 156 : 212;
  const grid = cn('grid gap-y-8', narrow ? 'grid-cols-2 gap-x-4' : 'grid-cols-[repeat(auto-fill,212px)] gap-x-6');

  return (
    <>
      <PageHeader compact title="Documents" sub="Each resume is written and designed for one quest, from your career record.">
        <Menu>
          <MenuTrigger asChild><Button variant="gold"><Plus /> New</Button></MenuTrigger>
          <MenuContent>
            <MenuItem onSelect={() => create('resume')}>Resume</MenuItem>
            <MenuItem onSelect={() => create('letter')}>Cover letter</MenuItem>
            <MenuItem onSelect={() => create('answer')}>Short answer</MenuItem>
          </MenuContent>
        </Menu>
      </PageHeader>

      <div ref={container} className="scroll-none relative mb-7 flex w-fit max-w-full gap-0.5 overflow-x-auto rounded-md bg-sunken/60 p-1 ring-1 ring-frame/15">
        <span ref={highlight} aria-hidden="true" className="absolute left-0 top-0 rounded-[5px] bg-surface opacity-0 shadow-soft ring-1 ring-frame/30 transition-[transform,width] duration-500 ease-spring" />
        {TABS.map(([k, label]) => (
          <button
            key={k}
            aria-pressed={tab === k}
            onClick={() => setTab(k)}
            className={cn('font-display relative z-[1] flex h-8 shrink-0 items-center gap-1.5 rounded-[5px] px-3.5 text-[15px] tracking-wide transition-colors', tab === k ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}
          >
            {label}
            <span className="font-mono text-[11px] text-muted-foreground">{k === 'all' ? docs.length : k === 'sources' ? fileCount : docs.filter((d) => d.kind === k).length}</span>
          </button>
        ))}
      </div>

      {tab === 'sources' ? (
        <Sources />
      ) : shown.length === 0 ? (
        <Empty icon={<FileText />} title="Nothing here yet">Create one, or open a quest and ask the guide to tailor a resume for it.</Empty>
      ) : (
        <div className={grid}>{shown.map((d) => <DocCard key={d.id} doc={d} width={card} job={d.jobId ? byId.get(d.jobId) : undefined} />)}</div>
      )}
    </>
  );
}
