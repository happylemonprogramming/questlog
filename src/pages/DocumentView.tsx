import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, ArrowLeft, Braces, CheckCircle2, ClipboardPen, Copy, Eye, FileText, MoreHorizontal, Printer, Sparkles, Star, Trash2 } from 'lucide-react';
import { db, now, uid } from '@/lib/db';
import { ask } from '@/agent/runtime';
import { applicationPage, openApplication } from '@/lib/workspace';
import { Empty } from '@/components/common';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { LetterSheet, ResumeSheet, ScaledSheet, SHEET_H } from '@/components/Sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/input';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import type { LetterData, ResumeData } from '@/lib/sheet';
import type { AnswerData, Doc } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Track an element's width. A callback ref, because the element mounts after the data loads. */
function useWidth() {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, w] as const;
}

function JsonEditor({ doc }: { doc: Doc }) {
  const [text, setText] = useState(() => JSON.stringify(doc.data, null, 2));
  const [error, setError] = useState('');
  useEffect(() => {
    if (!error) setText(JSON.stringify(doc.data, null, 2));
    // Only follow outside edits (e.g. the assistant's) when the draft is valid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.updatedAt]);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const data = JSON.parse(text);
        setError('');
        if (JSON.stringify(data) !== JSON.stringify(doc.data)) void db.docs.update(doc.id, { data, updatedAt: now() });
      } catch (e) {
        setError((e as Error).message);
      }
    }, 600);
    return () => clearTimeout(t);
  }, [text, doc.id, doc.data]);
  return (
    <div className="flex h-full flex-col">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        className="scroll-thin min-h-0 flex-1 resize-none rounded-xl border bg-sunken p-4 font-mono text-[12px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring/40"
      />
      <p className={cn('mt-2 text-[12px]', error ? 'text-danger' : 'text-muted-foreground')}>
        {error || 'Saved as you type. Links are written [text](url).'}
      </p>
    </div>
  );
}

function AnswerEditor({ doc }: { doc: Doc<AnswerData> }) {
  const [text, setText] = useState(doc.data.text);
  const [prompt, setPrompt] = useState(doc.data.prompt ?? '');
  const [dirty, setDirty] = useState(false);
  const [copied, setCopied] = useState(false);
  // Follow outside edits (the assistant's) until the user starts typing.
  useEffect(() => {
    if (dirty) return;
    setText(doc.data.text);
    setPrompt(doc.data.prompt ?? '');
  }, [doc.data, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(async () => {
      await db.docs.update(doc.id, { data: { text, prompt: prompt || undefined }, updatedAt: now() });
      setDirty(false);
    }, 500);
    return () => clearTimeout(t);
  }, [text, prompt, dirty, doc.id]);
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <label className="block space-y-1.5">
        <span className="eyebrow-label">Question on the form</span>
        <Textarea value={prompt} onChange={(e) => { setPrompt(e.target.value); setDirty(true); }} placeholder="e.g. Additional information" className="min-h-[44px]" rows={1} />
      </label>
      <div className="rounded-2xl border bg-surface shadow-soft">
        <Textarea value={text} onChange={(e) => { setText(e.target.value); setDirty(true); }} className="min-h-[320px] border-0 bg-transparent p-5 text-[15px] leading-7 focus-visible:ring-0" />
        <div className="flex items-center justify-between border-t px-4 py-2.5">
          <span className="font-mono text-[11.5px] text-muted-foreground">{words} words · {text.length} chars</span>
          <Button size="sm" variant={copied ? 'subtle' : 'lemon'} onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
            <Copy /> {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function DocumentView() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const doc = useLiveQuery(() => db.docs.get(id), [id]);
  const job = useLiveQuery(() => (doc?.jobId ? db.jobs.get(doc.jobId) : undefined), [doc?.jobId]);
  const [mode, setMode] = useState<'preview' | 'data'>('preview');
  const [fit, setFit] = useState<{ fits: boolean; height: number }>();
  const [title, setTitle] = useState('');
  const [box, width] = useWidth();
  const onFit = useCallback((fits: boolean, height: number) => setFit((f) => (f?.height === height ? f : { fits, height })), []);

  useEffect(() => {
    if (doc) setTitle(doc.title);
  }, [doc?.id, doc?.title]); // eslint-disable-line react-hooks/exhaustive-deps

  if (doc === undefined) return null;
  if (!doc) return <Empty icon={<FileText />} title="Document not found"><Link to="/documents" className="underline">Back to documents</Link></Empty>;

  const isSheet = doc.kind !== 'answer';
  const saveTitle = () => title.trim() && title !== doc.title && db.docs.update(doc.id, { title: title.trim(), updatedAt: now() });
  const sheetWidth = Math.min(width, 860);
  const overflowPct = fit && !fit.fits ? Math.round(((fit.height - SHEET_H) / SHEET_H) * 100) : 0;

  return (
    <>
      <Link to="/documents" className="mb-5 inline-flex max-lg:hidden items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Documents
      </Link>

      <div className="mb-6">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="-mx-1 w-[calc(100%+0.5rem)] rounded-md bg-transparent px-1 text-[21px] font-semibold sm:text-[24px] tracking-[-0.02em] outline-none ring-ring/40 focus:ring-2"
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge tone="outline" className="capitalize">{doc.kind}</Badge>
            {doc.base && <Badge tone="lemon"><Star className="fill-current" /> Base</Badge>}
            {doc.variant && <Badge>{doc.variant}</Badge>}
            {isSheet && fit && (
              fit.fits
                ? <Badge tone="success"><CheckCircle2 /> Fits one page</Badge>
                : <Badge tone="danger"><AlertTriangle /> {overflowPct}% over one page</Badge>
            )}
            {job && <Link to={`/jobs/${encodeURIComponent(job.id)}`} className="truncate text-[13px] text-muted-foreground hover:text-foreground hover:underline">for {job.company}: {job.title}</Link>}
          </div>
        <div className="flex flex-wrap items-center gap-2">
          {isSheet && (
            <div className="flex rounded-lg bg-muted p-0.5">
              {([['preview', <Eye key="e" />, 'Preview'], ['data', <Braces key="b" />, 'Data']] as const).map(([m, icon, label]) => (
                <button key={m} onClick={() => setMode(m)} className={cn('flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium [&_svg]:size-3.5', mode === m ? 'bg-surface shadow-soft' : 'text-muted-foreground hover:text-foreground')}>
                  {icon}{label}
                </button>
              ))}
            </div>
          )}
          <Button variant="outline" onClick={() => ask(`Improve ${doc.kind} ${doc.id} ("${doc.title}")${job ? ` for listing ${job.id}` : ''}. Tell me what you changed.`)}>
            <Sparkles className="text-lemon" /> Improve
          </Button>
          {job && applicationPage(job) && (
            <Button variant="outline" onClick={() => openApplication(job.id)}>
              <ClipboardPen /> Apply
            </Button>
          )}
          {isSheet && (
            <Button variant="primary" onClick={() => window.open(`/print/${doc.id}`, '_blank')}>
              <Printer /> Export PDF
            </Button>
          )}
          <Menu>
            <MenuTrigger asChild><Button variant="outline" size="icon" className="size-9" aria-label="More"><MoreHorizontal /></Button></MenuTrigger>
            <MenuContent>
              <MenuItem onSelect={() => db.docs.update(doc.id, { base: !doc.base, updatedAt: now() })}><Star /> {doc.base ? 'Unmark as base' : 'Mark as base'}</MenuItem>
              <MenuItem onSelect={async () => { const nid = uid(); await db.docs.add({ ...doc, id: nid, base: false, title: `${doc.title} (copy)`, createdAt: now(), updatedAt: now() }); navigate(`/documents/${nid}`); }}><Copy /> Duplicate</MenuItem>
              <MenuSeparator />
              <MenuItem danger onSelect={async () => { await db.docs.delete(doc.id); navigate('/documents'); }}><Trash2 /> Delete</MenuItem>
            </MenuContent>
          </Menu>
          </div>
        </div>
      </div>

      {doc.kind === 'answer' ? (
        <AnswerEditor doc={doc as Doc<AnswerData>} />
      ) : mode === 'data' ? (
        <div className="h-[calc(100vh-230px)] min-h-[420px]"><JsonEditor doc={doc} /></div>
      ) : (
        <div ref={box} className="paper-grid -mx-2 flex justify-center rounded-2xl border bg-sunken px-2 py-8 max-sm:-mx-4 max-sm:rounded-none max-sm:border-x-0 max-sm:px-0 max-sm:py-4">
          {width > 0 && (
            <div className="relative" style={{ width: sheetWidth }}>
              <ScaledSheet width={sheetWidth} onFit={onFit}>
                <ErrorBoundary resetKey={doc.updatedAt}>
                  {doc.kind === 'resume' ? <ResumeSheet data={doc.data as ResumeData} /> : <LetterSheet data={doc.data as LetterData} />}
                </ErrorBoundary>
              </ScaledSheet>
              {fit && !fit.fits && (
                <div className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed border-danger" style={{ top: SHEET_H * (sheetWidth / 816) }}>
                  <span className="absolute right-0 top-1 rounded bg-danger px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">PAGE 1 ENDS</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
