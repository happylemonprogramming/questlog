import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle, ArrowLeft, Check, ChevronDown, ClipboardPen, Clock, ExternalLink, FilePlus2, FileText, Layers, MapPin, MessageSquareText, MoreHorizontal, Rocket, Sparkles, ThumbsDown, ThumbsUp, Trash2, Wallet,
} from 'lucide-react';
import { db, logJob, now, today } from '@/lib/db';
import { ask } from '@/agent/runtime';
import { applicationPage, openApplication } from '@/lib/workspace';
import { Card, CompanyMark, Empty, STAGE_DOT, STAGE_VAR } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Textarea } from '@/components/ui/input';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { INTERVIEW_STEPS, SHOWN_STAGES, STAGE_HINT, STAGE_LABEL, type Job, type Outcome, type Stage } from '@/lib/types';
import { cn, timeAgo } from '@/lib/utils';
import { companyDomain } from '@/lib/logo';

const OUTCOMES: [Outcome, string][] = [
  ['in_progress', 'In progress'],
  ['interview_only', 'Interviewed, no offer'],
  ['rejected', 'Rejected'],
  ['no_response', 'No response'],
  ['offer_declined', 'Offer declined'],
  ['hired', 'Hired'],
  ['skipped', 'Skipped'],
];

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

function Fact({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground [&_svg]:size-3.5">{icon}{children}</span>;
}

/**
 * A field that saves itself a moment after you stop typing, and otherwise
 * follows the stored value, so the agent's edits show up live and are
 * never overwritten by a stale draft.
 */
function useAutosave(job: Job | undefined, key: 'notes' | 'batch' | 'website') {
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

/** The stage as one small control: the current stage, and a menu to change it. */
function StagePicker({ stage, onChange }: { stage: Stage; onChange: (s: Stage) => void }) {
  const c = STAGE_VAR[stage];
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          className="flex h-9 items-center gap-2 rounded-full px-3.5 text-[13.5px] font-medium transition hover:brightness-110"
          style={{ background: `hsl(var(${c}) / 0.14)`, boxShadow: `inset 0 0 0 1px hsl(var(${c}) / 0.4)` }}
        >
          <span className={cn('size-2 rounded-full', STAGE_DOT[stage])} />
          {STAGE_LABEL[stage]}
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </button>
      </MenuTrigger>
      <MenuContent align="start">
        {(SHOWN_STAGES.includes(stage as never) ? SHOWN_STAGES : [...SHOWN_STAGES, stage]).map((s) => (
          <MenuItem key={s} onSelect={() => onChange(s)}>
            <span className={cn('size-2 shrink-0 rounded-full', STAGE_DOT[s])} />
            <span className="flex flex-col">
              <span>{STAGE_LABEL[s]}</span>
              <span className="text-[11.5px] text-muted-foreground">{STAGE_HINT[s]}</span>
            </span>
            {s === stage && <Check className="ml-auto" />}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

/** A section kept closed until you want it, with a one-line hint of what's inside. */
function Fold({ title, icon, hint, open, children }: { title: string; icon: ReactNode; hint?: ReactNode; open?: boolean; children: ReactNode }) {
  return (
    <details open={open} className="group/fold">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 transition-colors hover:bg-accent/40 sm:px-6 [&::-webkit-details-marker]:hidden [&_svg]:size-4">
        <span className="text-muted-foreground">{icon}</span>
        <span className="text-[14.5px] font-medium">{title}</span>
        <span className="ml-auto min-w-0 truncate text-[13px] text-muted-foreground">{hint}</span>
        <ChevronDown className="shrink-0 text-muted-foreground transition-transform duration-300 group-open/fold:rotate-180" />
      </summary>
      <div className="px-5 pb-6 sm:px-6">{children}</div>
    </details>
  );
}

export default function JobView() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const job = useLiveQuery(() => db.jobs.get(id), [id]);
  const docs = useLiveQuery(() => db.docs.where('jobId').equals(id).toArray(), [id]) ?? [];
  const [notes, setNotes] = useAutosave(job, 'notes');
  const [batch, setBatch] = useAutosave(job, 'batch');
  const [website, setWebsite] = useAutosave(job, 'website');
  const [showPosting, setShowPosting] = useState(false);

  if (job === undefined) return null;
  if (!job) return <Empty icon={<FileText />} title="Listing not found"><Link to="/listings" className="underline">Back to jobs</Link></Empty>;

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

  const longPosting = (job.description?.length ?? 0) > 1400;

  const words = job.description ? job.description.trim().split(/\s+/).length : 0;
  const resume = docs.find((d) => d.kind === 'resume');
  const evaluate = () => ask(`Evaluate listing ${job.id} against my rules and profile. Read the posting if needed, then save strengths, gaps, flags and a one-sentence verdict on it.`);

  return (
    <div className="mx-auto max-w-[760px]">
      <Link to="/listings" className="mb-5 inline-flex max-lg:hidden items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Jobs
      </Link>

      <div className="rise mb-6 flex items-start gap-5">
        <CompanyMark job={job} size={64} className="rounded-[20px] max-sm:hidden" />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium text-muted-foreground">{job.company}</p>
          <h1 className="mt-0.5 font-display text-[26px] leading-[1.1] sm:text-[34px]">{job.title}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
            {job.location && <Fact icon={<MapPin />}>{job.location}</Fact>}
            {job.pay && <Fact icon={<Wallet />}><span className="font-mono text-[12.5px]">{job.pay}</span></Fact>}
            {job.moonshot && <Badge tone="violet"><Rocket /> Moonshot{job.moonshotRank ? ` #${job.moonshotRank}` : ''}</Badge>}
          </div>
        </div>
      </div>

      <div className="rise mb-6 flex flex-wrap items-center gap-2" style={{ '--i': 1 } as CSSProperties}>
        {applicationPage(job) ? (
          <Button variant="gold" size="lg" onClick={() => openApplication(job.id)}><ClipboardPen /> Apply here</Button>
        ) : job.url ? (
          <Button variant="gold" size="lg" onClick={() => window.open(job.url, '_blank', 'noopener')}><ExternalLink /> Apply on their site</Button>
        ) : null}
        {resume ? (
          <Button size="lg" variant="outline" onClick={() => navigate(`/documents/${resume.id}`)}><FileText /> Your resume for this</Button>
        ) : (
          <Button size="lg" variant="outline" onClick={() => ask(`Make a resume for listing ${job.id}, written from my career record for this role and designed for this company.`)}>
            <Sparkles className="text-gold" /> Make my resume
          </Button>
        )}
        <div className="flex items-center gap-2 sm:ml-auto">
          <StagePicker stage={job.stage} onChange={setStage} />
          <Menu>
            <MenuTrigger asChild><Button variant="ghost" size="icon" className="size-9" aria-label="More"><MoreHorizontal /></Button></MenuTrigger>
            <MenuContent align="end">
              {job.url && <MenuItem onSelect={() => window.open(job.url, '_blank', 'noopener')}><ExternalLink /> Open the posting</MenuItem>}
              <MenuItem onSelect={() => update({ moonshot: !job.moonshot })}><Rocket /> {job.moonshot ? 'Not a moonshot' : 'Mark as moonshot'}</MenuItem>
              <MenuItem danger onSelect={async () => { await db.jobs.delete(job.id); navigate('/listings'); }}><Trash2 /> Delete listing</MenuItem>
            </MenuContent>
          </Menu>
        </div>
      </div>

      <Card className="rise mb-6 p-5 sm:p-6" style={{ '--i': 2 } as CSSProperties}>
        {job.verdict || job.strengths?.length || job.gaps?.length ? (
          <>
            {job.verdict && <p className="text-[16px] leading-relaxed">{job.verdict}</p>}
            {(job.strengths?.length || job.gaps?.length) ? (
              <ul className={cn('space-y-1.5 text-[14px]', job.verdict && 'mt-4')}>
                {job.strengths?.slice(0, 2).map((x, i) => <li key={`s${i}`} className="flex gap-2.5"><ThumbsUp className="mt-0.5 size-4 shrink-0 text-success" />{x}</li>)}
                {job.gaps?.slice(0, 2).map((x, i) => <li key={`g${i}`} className="flex gap-2.5"><ThumbsDown className="mt-0.5 size-4 shrink-0 text-warning" />{x}</li>)}
              </ul>
            ) : null}
            {job.flags?.length ? <div className="mt-4 flex flex-wrap gap-1.5">{job.flags.map((f) => <Badge key={f} tone="warning"><AlertTriangle /> {f}</Badge>)}</div> : null}
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[14.5px] text-muted-foreground">No read on this one yet.</p>
            <Button size="sm" variant="outline" onClick={evaluate}><Sparkles className="text-gold" /> Is it a fit?</Button>
          </div>
        )}
      </Card>

      <Card className="rise divide-y divide-border/60 overflow-hidden" style={{ '--i': 3 } as CSSProperties}>
        <Fold title="Fit in full" icon={<Sparkles />} hint={job.strengths?.length || job.gaps?.length ? `${plural(job.strengths?.length ?? 0, 'strength')}, ${plural(job.gaps?.length ?? 0, 'gap')}` : 'Not evaluated'}>
          <div className="grid gap-5 @[640px]:grid-cols-2">
            <div>
              <p className="eyebrow-label mb-2 flex items-center gap-1.5 !text-success"><ThumbsUp className="size-3" /> Strengths</p>
              {job.strengths?.length ? (
                <ul className="space-y-1.5 text-[13.5px] leading-snug">
                  {job.strengths.map((x, i) => <li key={i} className="flex gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-success" />{x}</li>)}
                </ul>
              ) : <p className="text-[13px] text-muted-foreground">Not evaluated yet.</p>}
            </div>
            <div>
              <p className="eyebrow-label mb-2 flex items-center gap-1.5 !text-warning"><ThumbsDown className="size-3" /> Gaps</p>
              {job.gaps?.length ? (
                <ul className="space-y-1.5 text-[13.5px] leading-snug">
                  {job.gaps.map((x, i) => <li key={i} className="flex gap-2"><span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-warning" />{x}</li>)}
                </ul>
              ) : <p className="text-[13px] text-muted-foreground">None recorded.</p>}
            </div>
          </div>
          <Button size="sm" variant="ghost" className="mt-4 -ml-2" onClick={evaluate}><Sparkles className="text-gold" /> {job.strengths?.length ? 'Re-evaluate' : 'Evaluate'}</Button>
        </Fold>

        <Fold title="Posting" icon={<FileText />} hint={words ? `${words.toLocaleString()} words${job.posted ? ` · posted ${job.posted}` : ''}` : 'Not saved'}>
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
          ) : (
            <Button size="sm" variant="outline" onClick={() => ask(`Read the posting for listing ${job.id}${job.url ? ` (${job.url})` : ''} and save its text as the description.`)}>
              <Sparkles className="text-gold" /> Fetch the posting
            </Button>
          )}
        </Fold>

        <Fold title="Documents" icon={<FilePlus2 />} hint={docs.length ? `${docs.length} for this role` : 'None yet'}>
          <div className="space-y-1">
            {docs.map((d) => (
              <Link key={d.id} to={`/documents/${d.id}`} className="-mx-3 flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-accent/70">
                <div className="grid h-9 w-7 shrink-0 place-items-center rounded-[4px] border bg-background shadow-sm"><span className="h-0.5 w-3 rounded bg-gold" /></div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium">{d.title}</p>
                  <p className="text-[12px] capitalize text-muted-foreground">{d.kind} · {timeAgo(d.updatedAt)}</p>
                </div>
              </Link>
            ))}
          </div>
          <div className={cn('flex flex-wrap gap-2', docs.length > 0 && 'mt-3')}>
            <Button size="sm" variant="outline" onClick={() => ask(`Write a cover letter for listing ${job.id}, matching the resume for this listing. Save it linked to the listing.`)}>Cover letter</Button>
            <Button size="sm" variant="outline" onClick={() => ask(`Draft a short answer for the optional "Additional information" box on listing ${job.id}, in my voice. Save it linked to the listing.`)}>Short answer</Button>
          </div>
        </Fold>

        <Fold title="Notes" icon={<MessageSquareText />} hint={notes.trim() ? notes.trim().split('\n')[0] : 'Empty'}>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Recruiter names, what to mention, questions to ask…" className="min-h-[110px] bg-background" />
          <label className="mt-4 block space-y-1.5">
            <span className="eyebrow-label">Batch</span>
            <Input value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="e.g. spring push, remote" className="bg-background" />
          </label>
          <p className="mt-1.5 text-[12px] text-muted-foreground">Roles in the same batch are offered together on Today.</p>
          <label className="mt-4 block space-y-1.5">
            <span className="eyebrow-label">Company website</span>
            <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder={companyDomain({ url: job.url, portal: job.portal }) ?? 'e.g. anduril.com'} className="bg-background" />
          </label>
          <p className="mt-1.5 text-[12px] text-muted-foreground">Used for the logo. Leave it empty to use the posting's site when that's the company's own.</p>
        </Fold>

        {(['applied', 'interviewing', 'offer', 'closed'] as Stage[]).includes(job.stage) && (
          <Fold title="Outcome" icon={<Layers />} hint={job.appliedAt ? `Applied ${job.appliedAt}` : OUTCOMES.find(([v]) => v === (job.outcome ?? 'in_progress'))?.[1]}>
            <div className="space-y-1">
              {INTERVIEW_STEPS.map((x) => {
                const on = job.steps?.includes(x);
                return (
                  <button key={x} onClick={() => toggleStep(x)} className="flex w-full items-center gap-2.5 rounded-lg px-1 py-1 text-left text-[13.5px] hover:bg-accent/60">
                    <span className={cn('grid size-[18px] place-items-center rounded-md border transition', on ? 'border-violet bg-violet text-white' : 'border-input')}>
                      {on && <Check className="size-3" strokeWidth={3} />}
                    </span>
                    {x}
                  </button>
                );
              })}
            </div>
            <select value={job.outcome ?? 'in_progress'} onChange={(e) => update({ outcome: e.target.value as Outcome })} className="mt-4 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm">
              {OUTCOMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Fold>
        )}

        {job.log?.length ? (
          <Fold title="History" icon={<Clock />} hint={job.log.at(-1)?.text}>
            <ol className="relative ml-1 space-y-2.5 border-l pl-4">
              {[...job.log].reverse().map((l, i) => (
                <li key={i} className="relative text-[13px]">
                  <span className="absolute -left-[21px] top-1.5 size-2 rounded-full border-2 border-surface bg-muted-foreground/50" />
                  {l.text}
                  <p className="font-mono text-[11px] text-muted-foreground">{l.at}</p>
                </li>
              ))}
            </ol>
          </Fold>
        ) : null}
      </Card>
    </div>
  );
}
