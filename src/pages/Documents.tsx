import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { FileText, Plus, Star } from 'lucide-react';
import { db, now, uid } from '@/lib/db';
import { Empty, PageHeader } from '@/components/common';
import { Sources } from '@/components/Sources';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { LetterSheet, ResumeSheet, ScaledSheet } from '@/components/Sheet';
import { Button } from '@/components/ui/button';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { SAMPLE_RESUME, sampleLetter, type LetterData, type ResumeData } from '@/lib/sheet';
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
          {doc.kind === 'resume' ? <ResumeSheet data={doc.data as ResumeData} /> : <LetterSheet data={doc.data as LetterData} />}
        </ErrorBoundary>
      </ScaledSheet>
    </div>
  );
}

function DocCard({ doc, job, width }: { doc: Doc; job?: Job; width: number }) {
  const navigate = useNavigate();
  const open = () => navigate(`/documents/${doc.id}`);
  return (
    <div role="link" tabIndex={0} onClick={open} onKeyDown={(e) => e.key === 'Enter' && open()} style={{ width }} className="group block cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
      <div className="relative overflow-hidden rounded-xl border bg-sunken shadow-soft transition group-hover:-translate-y-1 group-hover:shadow-lift">
        <DocThumb doc={doc} width={width} />
      </div>
      <div className="mt-2.5 px-0.5">
        <p className="flex items-center gap-1.5 truncate text-[13.5px] font-medium">
          {doc.base && <Star className="size-3.5 shrink-0 fill-lemon text-lemon" aria-label="Base" />}
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
  const bases = shown.filter((d) => d.base);
  const rest = shown.filter((d) => !d.base);

  async function create(kind: DocKind) {
    const base = docs.find((d) => d.kind === 'resume' && d.base)?.data as ResumeData | undefined;
    const data = kind === 'resume' ? (base ?? SAMPLE_RESUME) : kind === 'letter' ? sampleLetter((base ?? SAMPLE_RESUME).header) : ({ text: '' } satisfies AnswerData);
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
      <PageHeader eyebrow="Documents" title="Resumes, letters and answers" sub="Base documents are the starting points that tailored copies come from.">
        <Menu>
          <MenuTrigger asChild><Button variant="primary"><Plus /> New</Button></MenuTrigger>
          <MenuContent>
            <MenuItem onSelect={() => create('resume')}>Resume</MenuItem>
            <MenuItem onSelect={() => create('letter')}>Cover letter</MenuItem>
            <MenuItem onSelect={() => create('answer')}>Short answer</MenuItem>
          </MenuContent>
        </Menu>
      </PageHeader>

      <div className="scroll-thin mb-6 flex gap-1 overflow-x-auto border-b">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cn('-mb-px shrink-0 border-b-2 px-3 pb-2.5 text-[13.5px] font-medium transition', tab === k ? 'border-lemon text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
          >
            {label}
            <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">{k === 'all' ? docs.length : k === 'sources' ? fileCount : docs.filter((d) => d.kind === k).length}</span>
          </button>
        ))}
      </div>

      {tab === 'sources' ? (
        <Sources />
      ) : shown.length === 0 ? (
        <Empty icon={<FileText />} title="Nothing here yet">Create one, or open a listing and ask the assistant to tailor a resume for it.</Empty>
      ) : (
        <div className="space-y-10">
          {bases.length > 0 && (
            <section>
              <p className="eyebrow-label mb-4">Base</p>
              <div className={grid}>{bases.map((d) => <DocCard key={d.id} doc={d} width={card} />)}</div>
            </section>
          )}
          {rest.length > 0 && (
            <section>
              <p className="eyebrow-label mb-4">Tailored</p>
              <div className={grid}>{rest.map((d) => <DocCard key={d.id} doc={d} width={card} job={d.jobId ? byId.get(d.jobId) : undefined} />)}</div>
            </section>
          )}
        </div>
      )}
    </>
  );
}
