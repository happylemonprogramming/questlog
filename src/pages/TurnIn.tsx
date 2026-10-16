import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, ChevronLeft, ChevronRight, ClipboardPen, FileText, Loader2, MessageCircleQuestion, Paperclip, Send, Sparkles } from 'lucide-react';
import { db, moveJob } from '@/lib/db';
import { ask } from '@/agent/runtime';
import { Empty, Panel, PanelHeader } from '@/components/common';
import { Signs } from '@/components/Signs';
import { Plate, Reward, Speech } from '@/components/game';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { DocThumb } from '@/pages/Documents';
import { isDesktop } from '@/lib/desktop';
import { XP } from '@/lib/quest';
import { answerText, needsYou, prepPrompt, setAnswer, turnIn, upNext, useTurnIn } from '@/lib/turnIn';
import { applicationPage, openApplication } from '@/lib/workspace';
import type { Doc, FormAnswer, Job } from '@/lib/types';
import { cn } from '@/lib/utils';

const field = 'w-full rounded-md border border-frame/35 bg-surface px-3 text-[14px] transition hover:border-frame/70 focus:border-gold/70 focus:outline-none';

/** One answer, changed in place. Text is kept on blur, so typing doesn't save every key. */
function AnswerInput({ answer, onChange }: { answer: FormAnswer; onChange: (v: FormAnswer['value']) => void }) {
  const [draft, setDraft] = useState(typeof answer.value === 'string' ? answer.value : '');
  useEffect(() => setDraft(typeof answer.value === 'string' ? answer.value : ''), [answer.value]);
  const opts = answer.options?.filter(Boolean) ?? [];

  if (answer.kind === 'checkbox' && !opts.length) {
    return (
      <div className="flex gap-1.5">
        {[true, false].map((v) => (
          <button key={String(v)} onClick={() => onChange(v)} className={cn('h-8 rounded-[5px] px-3 text-[13px] font-medium ring-1 ring-inset transition', answer.value === v ? 'bg-gold-soft text-foreground ring-gold/60' : 'text-muted-foreground ring-frame/25 hover:text-foreground')}>
            {v ? 'Yes' : 'No'}
          </button>
        ))}
      </div>
    );
  }
  if (answer.kind === 'checkbox') {
    const on = new Set(Array.isArray(answer.value) ? answer.value : []);
    return (
      <div className="flex flex-col gap-1.5">
        {opts.map((o) => (
          <label key={o} className="flex cursor-pointer items-center gap-2 text-[13.5px]">
            <input type="checkbox" checked={on.has(o)} onChange={(e) => onChange(e.target.checked ? [...on, o] : [...on].filter((x) => x !== o))} className="size-4 accent-[hsl(var(--gold))]" />
            {o}
          </label>
        ))}
      </div>
    );
  }
  if (opts.length) {
    return (
      <select value={String(answer.value ?? '')} onChange={(e) => onChange(e.target.value)} className={cn(field, 'h-10')}>
        <option value="">Choose…</option>
        {!opts.includes(String(answer.value)) && answer.value && <option value={String(answer.value)}>{String(answer.value)}</option>}
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (answer.kind === 'textarea') {
    return <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== answer.value && onChange(draft)} rows={Math.min(12, Math.max(3, Math.ceil(draft.length / 80)))} className="text-[14px] leading-relaxed" />;
  }
  return <Input value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== answer.value && onChange(draft)} className="h-10 text-[14px]" />;
}

/** One question on the form: read as text until you choose to change it, unless it's waiting on you. */
function AnswerRow({ answer, docs, onChange }: { answer: FormAnswer; docs: Doc[]; onChange: (v: FormAnswer['value']) => void }) {
  const open = needsYou(answer);
  const [editing, setEditing] = useState(false);
  const doc = answer.docId ? docs.find((d) => d.id === answer.docId) : undefined;
  return (
    <li className={cn('px-5 py-3', open && 'bg-warning/5')}>
      <div className="flex items-baseline gap-2">
        <p className="min-w-0 flex-1 text-[12.5px] font-medium text-muted-foreground">
          {answer.label.replace(/\s*\*\s*$/, '')}
          {answer.required && <span className="text-gold-ink"> *</span>}
        </p>
        {!open && answer.kind !== 'file' && (
          <button onClick={() => setEditing((e) => !e)} className="shrink-0 text-[12px] font-medium text-muted-foreground transition hover:text-foreground">{editing ? 'Done' : 'Change'}</button>
        )}
      </div>
      {answer.ask && <p className="mt-0.5 text-[12px] text-warning">{answer.ask}</p>}
      <div className="mt-1.5">
        {answer.kind === 'file' ? (
          <p className="flex items-center gap-2 text-[14px]">
            <Paperclip className="size-3.5 text-muted-foreground" />
            {doc ? <Link to={`/documents/${doc.id}`} className="hover:underline">{doc.title}</Link> : <span className="text-muted-foreground">{answerText(answer.value) || 'Nothing to attach'}</span>}
            {doc && <span className="text-[12px] text-muted-foreground">as a PDF</span>}
          </p>
        ) : open || editing ? (
          <AnswerInput answer={answer} onChange={onChange} />
        ) : (
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed">{answerText(answer.value) || <span className="text-muted-foreground">Left empty</span>}</p>
        )}
      </div>
    </li>
  );
}

/** Where a turn-in started here has got to. The rest of it shows on the form itself. */
function Progress({ job, next }: { job: Job; next?: Job }) {
  const t = useTurnIn();
  const navigate = useNavigate();
  if (job.stage === 'applied' || (t?.jobId === job.id && t.phase === 'sent')) {
    return (
      <div className="mt-5 flex flex-wrap items-center gap-3 rounded-md bg-success/10 px-4 py-3 ring-1 ring-inset ring-success/30">
        <Send className="size-4 text-success" />
        <p className="flex-1 text-[14px] font-medium">Turned in. Well done.</p>
        {next ? (
          <Button variant="gold" onClick={() => navigate(`/turn-in/${encodeURIComponent(next.id)}`)}>Next: {next.company} <ChevronRight /></Button>
        ) : (
          <Button variant="outline" onClick={() => navigate('/')}>Back to camp</Button>
        )}
      </div>
    );
  }
  if (t?.jobId !== job.id) return null;
  const working = ['opening', 'filling', 'checking', 'sending'].includes(t.phase);
  return (
    <div className={cn('mt-5 rounded-md px-4 py-3 text-[13.5px] ring-1 ring-inset', working ? 'bg-gold-soft/40 ring-gold/40' : 'bg-warning/10 ring-warning/30')}>
      <p className="flex items-center gap-2 font-medium">{working && <Loader2 className="size-4 animate-spin text-gold" />}{t.detail}</p>
      {!working && <p className="mt-0.5 text-muted-foreground">The form is open in Apply, where you can see it.</p>}
    </div>
  );
}

/**
 * One prepared application, to read through before it goes: the resume and
 * letter going with it, every question on the form and its answer, and the
 * ones left for you. Submit fills a fresh copy of the form from these and
 * sends it.
 */
export default function TurnIn() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const job = useLiveQuery(() => db.jobs.get(id), [id]);
  const jobs = useLiveQuery(() => db.jobs.toArray(), []) ?? [];
  const docs = useLiveQuery(() => db.docs.where('jobId').equals(id).toArray(), [id]) ?? [];
  const t = useTurnIn();

  if (job === undefined) return null;
  if (!job) return <Empty icon={<FileText />} title="No such quest">It may have been deleted. <Link to="/" className="underline">Back to camp</Link>.</Empty>;

  const queue = upNext(jobs).filter((j) => j.application);
  const at = queue.findIndex((j) => j.id === job.id);
  const prev = at > 0 ? queue[at - 1] : undefined;
  // Once it's sent it leaves the queue, and the next one is the first left.
  const next = at >= 0 ? queue[at + 1] ?? queue.find((j) => j.id !== job.id) : queue[0];
  const app = job.application;
  const resume = docs.filter((d) => d.kind === 'resume').sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const letter = docs.filter((d) => d.kind === 'letter').sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const open = app?.answers.filter(needsYou) ?? [];
  const busy = t?.jobId === job.id && ['opening', 'filling', 'checking', 'sending'].includes(t.phase);
  const steps = Math.max(1, ...(app?.answers.map((a) => a.step ?? 1) ?? [1]));
  const page = applicationPage(job);

  return (
    <div className="mx-auto max-w-[1000px]">
      <div className="mb-4 flex items-center gap-2">
        <Link to="/" className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"><ArrowLeft className="size-3.5" /> Camp</Link>
        {at >= 0 && queue.length > 1 && (
          <div className="ml-auto flex items-center gap-1">
            <Button size="icon" variant="ghost" disabled={!prev} onClick={() => prev && navigate(`/turn-in/${encodeURIComponent(prev.id)}`)} aria-label="Previous"><ChevronLeft /></Button>
            <span className="font-mono text-[12px] tabular-nums text-muted-foreground">{at + 1} of {queue.length}</span>
            <Button size="icon" variant="ghost" disabled={at >= queue.length - 1} onClick={() => navigate(`/turn-in/${encodeURIComponent(queue[at + 1].id)}`)} aria-label="Next"><ChevronRight /></Button>
          </div>
        )}
      </div>

      <Panel hero className="relative overflow-hidden">
        <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-[radial-gradient(closest-side,hsl(var(--gold)/0.16),transparent)]" />
        <div className="relative p-5 sm:p-7">
          <div className="flex items-center gap-2">
            <Plate className="border-gold/50 bg-gold-soft/50 text-gold-ink">{job.stage === 'applied' ? 'Turned in' : open.length ? 'Questions for you' : 'Ready to submit'}</Plate>
            <Reward xp={XP.turnedIn} className="ml-auto" />
          </div>
          <p className="mt-5 text-[13.5px] font-medium text-muted-foreground">{job.company}</p>
          <Link to={`/jobs/${encodeURIComponent(job.id)}`} className="mt-0.5 block font-display text-[26px] leading-tight hover:underline sm:text-[30px]">{job.title}</Link>
          <Signs job={job} labels className="mt-3" />
          {app?.note && <Speech compact className="mt-5"><p>{app.note}</p></Speech>}

          {app && job.stage !== 'applied' && (
            <div className="mt-6 flex flex-wrap items-center gap-2">
              <Button
                size="lg"
                variant="gold"
                disabled={!isDesktop() || busy || open.length > 0 || !page}
                title={open.length ? 'Answer the questions left for you first' : 'Fills the form from these answers and sends it'}
                onClick={() => void turnIn(job)}
              >
                {busy ? <Loader2 className="animate-spin" /> : <Send />} Submit
              </Button>
              {page && isDesktop() && <Button variant="outline" onClick={() => openApplication(job.id)}><ClipboardPen /> See the form</Button>}
              <Button variant="ghost" className="text-muted-foreground" onClick={() => moveJob(job, 'applied', 'Turned in')}>I sent it myself</Button>
              <span className="text-[12.5px] text-muted-foreground max-sm:basis-full">
                {open.length ? `Answer ${open.length === 1 ? 'the question' : `the ${open.length} questions`} below first.` : 'Fills a fresh copy of the form from what’s here, checks it, and sends it.'}
              </span>
            </div>
          )}
          <Progress job={job} next={next} />
        </div>
      </Panel>

      {!app ? (
        <div className="mt-6">
          <Empty icon={<Sparkles />} title="Not ready yet">
            The guide hasn’t filled in this one’s form.
            <div className="mt-4"><Button variant="gold" onClick={() => ask(prepPrompt([job]))}><Sparkles /> Get it ready</Button></div>
          </Empty>
        </div>
      ) : (
        <div className="mt-6 grid gap-6 @[760px]:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="space-y-4">
            {[resume, letter].filter((d): d is Doc => !!d).map((d) => (
              <Link key={d.id} to={`/documents/${d.id}`} className="group block">
                <div className="cursor overflow-hidden rounded-[4px] border border-frame/40 bg-sunken shadow-soft transition duration-300 ease-spring group-hover:-translate-y-1 group-hover:-rotate-1">
                  <DocThumb doc={d} width={240} />
                </div>
                <p className="mt-2 truncate px-0.5 text-[13px] font-medium">{d.title}</p>
                <p className="px-0.5 text-[12px] text-muted-foreground">{d.kind === 'letter' ? 'Cover letter' : 'Resume'} · open to read or change</p>
              </Link>
            ))}
            {!resume && (
              <Panel className="p-4 text-[13px] text-muted-foreground">
                No resume made for this one.
                <Button size="sm" variant="outline" className="mt-3" onClick={() => ask(`Make my resume for ${job.company}: ${job.title} (listing ${job.id}), written from my career record and designed for this company.`)}><Sparkles /> Make it</Button>
              </Panel>
            )}
          </aside>

          <div className="min-w-0 space-y-6">
            {open.length > 0 && (
              <Panel className="ring-1 ring-warning/30">
                <PanelHeader title="Left for you" icon={<MessageCircleQuestion />} count={open.length} />
                <p className="px-5 pb-2 text-[13px] text-muted-foreground">The guide couldn’t answer these truthfully from what it knows. Your answers are kept here and go in when you submit.</p>
                <ul className="divide-y divide-frame/15 pb-2">
                  {app.answers.map((a, i) => needsYou(a) && <AnswerRow key={i} answer={a} docs={docs} onChange={(v) => setAnswer(job, i, v)} />)}
                </ul>
              </Panel>
            )}
            {Array.from({ length: steps }, (_, s) => s + 1).map((step) => (
              <Panel key={step}>
                <PanelHeader title={steps > 1 ? `The form, page ${step}` : 'The form'} icon={<ClipboardPen />} count={app.answers.filter((a) => (a.step ?? 1) === step && !needsYou(a)).length} />
                <ul className="divide-y divide-frame/15 pb-2">
                  {app.answers.map((a, i) => (a.step ?? 1) === step && !needsYou(a) && <AnswerRow key={i} answer={a} docs={docs} onChange={(v) => setAnswer(job, i, v)} />)}
                </ul>
              </Panel>
            ))}
            <p className="px-1 text-[12.5px] text-muted-foreground">
              Prepared {new Date(app.preparedAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.{' '}
              <button onClick={() => ask(prepPrompt([job]))} className="underline decoration-frame/50 underline-offset-2 hover:text-foreground">Have the guide fill it in again</button>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
