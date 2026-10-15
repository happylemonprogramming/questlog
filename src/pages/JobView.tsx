import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle, ArrowLeft, Check, ClipboardPen, ExternalLink, FilePlus2, FileText, Layers, MapPin, MessageSquareText, MoreHorizontal, Rocket, Sparkles, ThumbsDown, ThumbsUp, Trash2, Wallet,
} from 'lucide-react';
import { db, logJob, now, today, uid } from '@/lib/db';
import { ask } from '@/agent/runtime';
import { applicationPage, openApplication } from '@/lib/workspace';
import { Card, CardHeader, CompanyMark, Empty, STAGE_DOT, STAGE_VAR } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Textarea } from '@/components/ui/input';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { INTERVIEW_STEPS, STAGES, STAGE_LABEL, type Job, type Outcome, type Stage } from '@/lib/types';
import { cn, timeAgo } from '@/lib/utils';
import { useSlidingHighlight } from '@/lib/motion';

const OUTCOMES: [Outcome, string][] = [
  ['in_progress', 'In progress'],
  ['interview_only', 'Interviewed, no offer'],
  ['rejected', 'Rejected'],
  ['no_response', 'No response'],
  ['offer_declined', 'Offer declined'],
  ['hired', 'Hired'],
  ['skipped', 'Skipped'],
];

function Fact({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground [&_svg]:size-3.5">{icon}{children}</span>;
}

/**
 * A field that saves itself a moment after you stop typing, and otherwise
 * follows the stored value, so the assistant's edits show up live and are
 * never overwritten by a stale draft.
 */
function useAutosave(job: Job | undefined, key: 'notes' | 'batch') {
  const stored = (job?.[key] as string | undefined) ?? '';
  const [value, setValue] = useState(stored);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setValue(stored);
  }, [stored, dirty, job?.id]);
  useEffect(() => {
    if (!dirty || !job) return;
    const t = setTimeout(async () => {
      await db.jobs.update(job.id, { [key]: value || undefined, updatedAt: now() } as Partial<Job>);
      setDirty(false);
    }, 500);
    return () => clearTimeout(t);
  }, [value, dirty, job, key]);
  const edit = (v: string) => {
    setValue(v);
    setDirty(true);
  };
  return [value, edit] as const;
}

/** The stages as one segmented control; the highlight slides and takes the stage's color. */
function StageStepper({ stage, onChange }: { stage: Stage; onChange: (s: Stage) => void }) {
  const { container, highlight } = useSlidingHighlight<HTMLDivElement, HTMLSpanElement>('[aria-pressed="true"]', stage);
  const c = STAGE_VAR[stage];
  return (
    <div ref={container} className="rise scroll-none relative mb-8 flex gap-1 overflow-x-auto rounded-[20px] border border-border/70 bg-surface p-1.5 shadow-card" style={{ '--i': 1 } as CSSProperties}>
      <span
        ref={highlight}
        aria-hidden="true"
        className="absolute left-0 top-0 rounded-[14px] opacity-0 transition-[transform,width,background-color,box-shadow] duration-500 ease-spring"
        style={{ background: `hsl(var(${c}) / 0.16)`, boxShadow: `inset 0 0 0 1px hsl(var(${c}) / 0.45), 0 6px 20px -8px hsl(var(${c}) / 0.6)` }}
      />
      {STAGES.map((s) => (
        <button
          key={s}
          aria-pressed={stage === s}
          onClick={() => onChange(s)}
          className={cn(
            'relative z-[1] flex h-10 flex-1 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[14px] px-3.5 text-[13.5px] font-medium transition-colors duration-200',
            stage === s ? 'text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
          )}
        >
          <span className={cn('size-1.5 rounded-full transition-transform duration-300', STAGE_DOT[s], stage === s && 'scale-150')} />
          {STAGE_LABEL[s]}
        </button>
      ))}
    </div>
  );
}

export default function JobView() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const job = useLiveQuery(() => db.jobs.get(id), [id]);
  const docs = useLiveQuery(() => db.docs.where('jobId').equals(id).toArray(), [id]) ?? [];
  const bases = useLiveQuery(() => db.docs.filter((d) => d.kind === 'resume' && !!d.base).toArray(), []) ?? [];
  const [notes, setNotes] = useAutosave(job, 'notes');
  const [batch, setBatch] = useAutosave(job, 'batch');
  const [showPosting, setShowPosting] = useState(false);

  if (job === undefined) return null;
  if (!job) return <Empty icon={<FileText />} title="Listing not found"><Link to="/listings" className="underline">Back to listings</Link></Empty>;

  const update = (patch: Partial<Job>) => db.jobs.update(job.id, { ...patch, updatedAt: now() });
  const setStage = async (stage: Stage) => {
    if (stage === job.stage) return;
    await update({ stage, ...(stage === 'applied' && !job.appliedAt ? { appliedAt: today(), outcome: 'in_progress' as const } : {}) });
    await logJob(job.id, `Moved to ${STAGE_LABEL[stage]}`);
  };
  const toggleStep = (s: string) => {
    const has = job.steps?.includes(s);
    return update({ steps: has ? job.steps!.filter((x) => x !== s) : INTERVIEW_STEPS.filter((x) => x === s || job.steps?.includes(x)) });
  };
  const newFromBase = async (baseId: string) => {
    const base = await db.docs.get(baseId);
    if (!base) return;
    const docId = uid();
    await db.docs.add({ ...base, id: docId, base: false, jobId: job.id, title: `${job.company}: ${job.title}`, createdAt: now(), updatedAt: now() });
    navigate(`/documents/${docId}`);
  };

  const longPosting = (job.description?.length ?? 0) > 1400;

  return (
    <>
      <Link to="/listings" className="mb-5 inline-flex max-lg:hidden items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Listings
      </Link>

      <div className="rise mb-8 flex flex-wrap items-start gap-5">
        <CompanyMark name={job.company} size={64} className="rounded-[20px] max-sm:hidden" />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium text-muted-foreground">{job.company}</p>
          <h1 className="mt-0.5 text-[24px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[30px]">{job.title}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
            {job.location && <Fact icon={<MapPin />}>{job.location}</Fact>}
            {job.pay && <Fact icon={<Wallet />}><span className="font-mono text-[12.5px]">{job.pay}</span></Fact>}
            {job.posted && <Fact icon={<FileText />}>Posted {job.posted}</Fact>}
            {job.moonshot && <Badge tone="violet"><Rocket /> Moonshot{job.moonshotRank ? ` #${job.moonshotRank}` : ''}</Badge>}
          </div>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          {applicationPage(job) && (
            <Button variant="lemon" className="flex-1 sm:flex-none" onClick={() => openApplication(job.id)}>
              <ClipboardPen /> Apply here
            </Button>
          )}
          {job.url && (
            <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => window.open(job.url, '_blank', 'noopener')}>
              Posting <ExternalLink />
            </Button>
          )}
          <Menu>
            <MenuTrigger asChild><Button variant="outline" size="icon" className="size-9" aria-label="More"><MoreHorizontal /></Button></MenuTrigger>
            <MenuContent>
              <MenuItem onSelect={() => update({ moonshot: !job.moonshot })}><Rocket /> {job.moonshot ? 'Not a moonshot' : 'Mark as moonshot'}</MenuItem>
              <MenuItem danger onSelect={async () => { await db.jobs.delete(job.id); navigate('/listings'); }}><Trash2 /> Delete listing</MenuItem>
            </MenuContent>
          </Menu>
        </div>
      </div>

      <StageStepper stage={job.stage} onChange={setStage} />

      <div className="grid grid-cols-1 gap-6 @[880px]:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Fit" icon={<Sparkles />} action={
              <Button size="sm" variant="ghost" onClick={() => ask(`Evaluate listing ${job.id} against my rules and profile. Read the posting if needed, then save strengths, gaps and flags on it.`)}>
                <Sparkles className="text-lemon" /> {job.strengths?.length ? 'Re-evaluate' : 'Evaluate'}
              </Button>
            } />
            <div className="grid gap-5 px-6 pb-6 pt-1 @[640px]:grid-cols-2">
              <div>
                <p className="eyebrow-label mb-2 flex items-center gap-1.5 !text-success"><ThumbsUp className="size-3" /> Strengths</p>
                {job.strengths?.length ? (
                  <ul className="space-y-1.5 text-[13.5px] leading-snug">
                    {job.strengths.map((s, i) => <li key={i} className="flex gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-success" />{s}</li>)}
                  </ul>
                ) : <p className="text-[13px] text-muted-foreground">Not evaluated yet.</p>}
              </div>
              <div>
                <p className="eyebrow-label mb-2 flex items-center gap-1.5 !text-warning"><ThumbsDown className="size-3" /> Gaps</p>
                {job.gaps?.length ? (
                  <ul className="space-y-1.5 text-[13.5px] leading-snug">
                    {job.gaps.map((s, i) => <li key={i} className="flex gap-2"><span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-warning" />{s}</li>)}
                  </ul>
                ) : <p className="text-[13px] text-muted-foreground">None recorded.</p>}
              </div>
              {job.flags?.length ? (
                <div className="flex flex-wrap gap-1.5 md:col-span-2">
                  {job.flags.map((f) => <Badge key={f} tone="warning"><AlertTriangle /> {f}</Badge>)}
                </div>
              ) : null}
              {job.verdict && <p className="text-[13px] text-muted-foreground md:col-span-2">Verdict: <span className="text-foreground">{job.verdict}</span></p>}
            </div>
          </Card>

          <Card>
            <CardHeader title="Posting" icon={<FileText />} action={job.description ? null : (
              <Button size="sm" variant="ghost" onClick={() => ask(`Read the posting for listing ${job.id}${job.url ? ` (${job.url})` : ''} and save its text as the description.`)}>
                <Sparkles className="text-lemon" /> Fetch posting
              </Button>
            )} />
            <div className="px-5 pb-5">
              {job.description ? (
                <div className="relative">
                  <div className={cn('whitespace-pre-wrap text-[13.5px] leading-relaxed text-foreground/85', !showPosting && longPosting && 'max-h-[340px] overflow-hidden')}>
                    {job.description}
                  </div>
                  {longPosting && (
                    <div className={cn('flex justify-center', !showPosting && 'absolute inset-x-0 bottom-0 bg-gradient-to-t from-surface via-surface/90 to-transparent pb-1 pt-16')}>
                      <Button size="sm" variant="outline" onClick={() => setShowPosting(!showPosting)}>{showPosting ? 'Show less' : 'Show full posting'}</Button>
                    </div>
                  )}
                </div>
              ) : <p className="text-[13px] text-muted-foreground">No posting text saved.</p>}
            </div>
          </Card>

          <Card>
            <CardHeader title="Notes" icon={<MessageSquareText />} />
            <div className="px-5 pb-5">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Recruiter names, what to mention, questions to ask…" className="min-h-[110px] bg-background" />
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Documents" icon={<FileText />} count={docs.length} />
            <div className="space-y-1 px-2 pb-2">
              {docs.map((d) => (
                <Link key={d.id} to={`/documents/${d.id}`} className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-accent/70">
                  <div className="grid h-9 w-7 shrink-0 place-items-center rounded-[4px] border bg-background shadow-sm"><span className="h-0.5 w-3 rounded bg-lemon" /></div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium">{d.title}</p>
                    <p className="text-[12px] capitalize text-muted-foreground">{d.kind} · {timeAgo(d.updatedAt)}</p>
                  </div>
                </Link>
              ))}
            </div>
            <div className="space-y-2 border-t p-3">
              <Button variant="lemon" className="w-full" onClick={() => ask(`Tailor a resume for listing ${job.id}. Start from the best base resume, keep it to one page, and save it linked to the listing.`)}>
                <Sparkles /> Tailor resume with assistant
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="outline" onClick={() => ask(`Write a cover letter for listing ${job.id}, matching my tailored or base resume. Save it linked to the listing.`)}>Cover letter</Button>
                <Button size="sm" variant="outline" onClick={() => ask(`Draft a short answer for the optional "Additional information" box on listing ${job.id}, in my voice. Save it linked to the listing.`)}>Short answer</Button>
              </div>
              {bases.length > 0 && (
                <Menu>
                  <MenuTrigger asChild><Button size="sm" variant="ghost" className="w-full text-muted-foreground"><FilePlus2 /> Copy a base resume by hand</Button></MenuTrigger>
                  <MenuContent align="center">
                    {bases.map((b) => <MenuItem key={b.id} onSelect={() => newFromBase(b.id)}>{b.title}</MenuItem>)}
                  </MenuContent>
                </Menu>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Batch" icon={<Layers />} />
            <div className="px-5 pb-5">
              <Input value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="e.g. spring push, remote" className="bg-background" />
              <p className="mt-1.5 text-[12px] text-muted-foreground">Roles in the same batch are grouped on Today.</p>
            </div>
          </Card>

          {(['applied', 'interviewing', 'offer', 'closed'] as Stage[]).includes(job.stage) && (
            <Card>
              <CardHeader title="Outcome" />
              <div className="space-y-4 px-5 pb-5">
                {job.appliedAt && <p className="text-[13px] text-muted-foreground">Applied {job.appliedAt}</p>}
                <div className="space-y-1">
                  {INTERVIEW_STEPS.map((s) => {
                    const on = job.steps?.includes(s);
                    return (
                      <button key={s} onClick={() => toggleStep(s)} className="flex w-full items-center gap-2.5 rounded-lg px-1 py-1 text-left text-[13.5px] hover:bg-accent/60">
                        <span className={cn('grid size-[18px] place-items-center rounded-md border transition', on ? 'border-violet bg-violet text-white' : 'border-input')}>
                          {on && <Check className="size-3" strokeWidth={3} />}
                        </span>
                        {s}
                      </button>
                    );
                  })}
                </div>
                <select value={job.outcome ?? 'in_progress'} onChange={(e) => update({ outcome: e.target.value as Outcome })} className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm">
                  {OUTCOMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            </Card>
          )}

          {job.log?.length ? (
            <Card>
              <CardHeader title="History" />
              <ol className="relative mx-5 mb-5 space-y-2.5 border-l pl-4">
                {[...job.log].reverse().map((l, i) => (
                  <li key={i} className="relative text-[13px]">
                    <span className="absolute -left-[21px] top-1.5 size-2 rounded-full border-2 border-surface bg-muted-foreground/50" />
                    {l.text}
                    <p className="font-mono text-[11px] text-muted-foreground">{l.at}</p>
                  </li>
                ))}
              </ol>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
