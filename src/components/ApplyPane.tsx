import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, Copy, ExternalLink, FileDown, Info, Loader2, Paperclip, RotateCw, ShieldAlert, Sparkles, X } from 'lucide-react';
import { desktop, isDesktop } from '@/lib/desktop';
import { ask } from '@/agent/runtime';
import { db, getProfile } from '@/lib/db';
import { applicationPage, closeApplication, setPane } from '@/lib/workspace';
import type { LetterData } from '@/lib/sheet';
import type { AnswerData, Doc } from '@/lib/types';
import { Empty } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Tip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const plain = (s: string) => s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*?([^*]+)\*\*?/g, '$1');

/** A cover letter as text for a form's cover letter box. */
export function letterText(l: LetterData): string {
  return [
    l.salutation,
    l.opening,
    ...(l.points ?? []).map((p) => `${p.lead}: ${p.text}`),
    ...(l.body ?? []),
    l.closing,
    `${l.signoff}\n${l.header?.name ?? ''}`.trim(),
  ].filter(Boolean).map(plain).join('\n\n');
}

function CopyChip({ label, text, icon }: { label: string; text: string; icon?: ReactNode }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      title={text.length > 120 ? `${text.slice(0, 120)}…` : text}
      className={cn(
        'flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition [&_svg]:size-3.5',
        done ? 'border-success/40 bg-success/10 text-success' : 'bg-surface hover:bg-accent',
      )}
    >
      {done ? <Check /> : icon ?? <Copy className="text-muted-foreground" />}
      {done ? 'Copied' : label}
    </button>
  );
}

/**
 * Desktop only: put the resume, as a PDF, into the form's resume upload. Picks
 * the file field labeled resume or CV, or the first one.
 */
function AttachChip({ docId }: { docId: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | string>('idle');
  async function attach() {
    const d = desktop()!;
    setState('busy');
    try {
      const form = await d.form.read();
      const files = form.fields.filter((f) => f.kind === 'file');
      const field = files.find((f) => /resume|cv/i.test(f.label)) ?? files[0];
      if (!field) throw new Error('No upload field on this page yet');
      const r = await d.form.attach(field.ref, docId);
      if (!r.ok) throw new Error(r.note);
      setState('done');
    } catch (e) {
      setState((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
  }
  return (
    <button
      onClick={attach}
      disabled={state === 'busy'}
      title={state.length > 6 ? state : 'Attach your resume to the form as a PDF'}
      className={cn('flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition [&_svg]:size-3.5', state === 'done' ? 'bg-success/15 text-success' : state.length > 6 ? 'bg-danger/10 text-danger' : 'bg-gold text-gold-foreground hover:brightness-95')}
    >
      {state === 'busy' ? <Loader2 className="animate-spin" /> : state === 'done' ? <Check /> : <Paperclip />}
      {state === 'done' ? 'Resume attached' : state.length > 6 ? 'Couldn’t attach' : 'Attach resume'}
    </button>
  );
}

/** Everything you'd paste into an application form, one tap each. */
function Materials({ jobId }: { jobId: string }) {
  const profile = useLiveQuery(() => getProfile(), []);
  const docs = useLiveQuery(() => db.docs.where('jobId').equals(jobId).toArray(), [jobId]) ?? [];
  const linkedin = profile?.links?.find((l) => /linkedin/i.test(l.href));
  const chips: ReactNode[] = [];
  for (const d of docs) {
    if (d.kind === 'resume' && isDesktop()) {
      chips.push(<AttachChip key={d.id} docId={d.id} />);
    } else if (d.kind === 'resume') {
      chips.push(
        <a key={d.id} href={`/print/${d.id}`} target="_blank" rel="noopener" className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-gold px-3 text-[12.5px] font-medium text-gold-foreground hover:brightness-95 [&_svg]:size-3.5">
          <FileDown /> Resume PDF
        </a>,
      );
    } else if (d.kind === 'letter') {
      chips.push(<CopyChip key={d.id} label="Cover letter" text={letterText(d.data as LetterData)} />);
    } else {
      const a = (d as Doc<AnswerData>).data;
      chips.push(<CopyChip key={d.id} label={a.prompt ? (a.prompt.length > 28 ? `${a.prompt.slice(0, 27)}…` : a.prompt) : d.title} text={a.text} />);
    }
  }
  if (profile?.name) {
    const [first, ...rest] = profile.name.split(' ');
    chips.push(<CopyChip key="first" label="First name" text={first} />, <CopyChip key="last" label="Last name" text={rest.join(' ')} />);
  }
  if (profile?.email) chips.push(<CopyChip key="email" label="Email" text={profile.email} />);
  if (profile?.phone) chips.push(<CopyChip key="phone" label="Phone" text={profile.phone} />);
  if (linkedin) chips.push(<CopyChip key="li" label="LinkedIn" text={linkedin.href} />);
  if (profile?.location) chips.push(<CopyChip key="loc" label="Location" text={profile.location} />);
  return (
    <div className="scroll-thin flex gap-1.5 overflow-x-auto border-b bg-sunken/60 px-3 py-2">
      {isDesktop() && (
        <button onClick={() => ask(`Fill out the application form for listing ${jobId}. Attach my resume for it, fill everything you can answer truthfully, and tell me what's left for me.`)} className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 text-[12.5px] font-medium text-primary-foreground hover:opacity-90 [&_svg]:size-3.5">
          <Sparkles className="text-gold" /> Fill it in for me
        </button>
      )}
      {chips}
    </div>
  );
}

/**
 * The employer's application form in a frame, with your materials above it.
 * Kept mounted while hidden, so a half-filled form survives switching panes.
 */
export function ApplyPane({ jobId, mobile }: { jobId: string | null; mobile?: boolean }) {
  const job = useLiveQuery(() => (jobId ? db.jobs.get(jobId) : undefined), [jobId]);
  const [reload, setReload] = useState(0);
  const page = job ? applicationPage(job) : null;
  const [tryAnyway, setTryAnyway] = useState(false);

  if (!jobId || job === null) {
    return (
      <div className="grid h-full place-items-center p-6">
        <Empty icon={<ExternalLink />} title="No application open">
          Open a listing and tap <b>Apply here</b> to fill its form next to your documents and the agent.
          <div className="mt-4"><Button variant="outline" onClick={() => setPane('page')}>Back to the app</Button></div>
        </Empty>
      </div>
    );
  }
  if (!job) return null;

  // The desktop app's webview loads any site; only a browser frame can be refused.
  const frame = page && (isDesktop() || page.embed !== 'no' || tryAnyway);

  return (
    <div className="flex h-full min-w-0 flex-col bg-surface">
      <div className={cn('flex shrink-0 items-center gap-2 border-b px-3', mobile ? 'h-14' : 'h-12')}>
        <Link to={`/jobs/${encodeURIComponent(job.id)}`} onClick={() => setPane('page')} className="min-w-0 flex-1 leading-tight hover:underline">
          <p className="truncate text-[13px] font-semibold">{job.title}</p>
          <p className="truncate text-[11.5px] text-muted-foreground">{job.company} · application</p>
        </Link>
        {frame && <Tip label="Reload form"><Button variant="ghost" size="icon" onClick={() => setReload((r) => r + 1)} aria-label="Reload form"><RotateCw /></Button></Tip>}
        {page && <Tip label="Open in a new tab"><Button variant="ghost" size="icon" onClick={() => window.open(page.url, '_blank', 'noopener')} aria-label="Open in a new tab"><ExternalLink /></Button></Tip>}
        <Tip label="Close application"><Button variant="ghost" size="icon" onClick={closeApplication} aria-label="Close application"><X /></Button></Tip>
      </div>
      <Materials jobId={job.id} />
      {!page ? (
        <div className="grid flex-1 place-items-center p-6">
          <Empty icon={<Info />} title="No link for this listing">Add the posting link to the listing, or ask the agent to find it.</Empty>
        </div>
      ) : frame ? (
        <>
          {page.embed === 'maybe' && !isDesktop() && (
            <p className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-[12px] text-muted-foreground">
              <Info className="size-3.5 shrink-0" />
              <span>Some career sites refuse to load inside other apps. If this stays blank, use <b>Open in a new tab</b>.</span>
            </p>
          )}
          {isDesktop() ? (
            <webview
              key={`${job.id}:${reload}`}
              src={page.url}
              partition="persist:apply"
              // @ts-expect-error React passes it through as the attribute the webview reads.
              allowpopups="true"
              className="min-h-0 w-full flex-1 bg-white"
            />
          ) : (
          <iframe
            key={`${job.id}:${reload}`}
            src={page.url}
            title={`${job.company} application`}
            // Forms, uploads and sign-in pop-ups work; the page can't navigate Questlog itself.
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals"
            allow="clipboard-read; clipboard-write"
            referrerPolicy="strict-origin-when-cross-origin"
            className="min-h-0 w-full flex-1 bg-white"
          />
          )}
        </>
      ) : (
        <div className="grid flex-1 place-items-center p-6">
          <Empty icon={<ShieldAlert />} title={`${new URL(page.url).hostname} can't be shown here`}>
            This site blocks being loaded inside other apps. Open it in a new tab; your materials above stay one tap away.
            <div className="mt-4 flex justify-center gap-2">
              <Button variant="primary" onClick={() => window.open(page.url, '_blank', 'noopener')}><ExternalLink /> Open the form</Button>
              <Button variant="ghost" onClick={() => setTryAnyway(true)}>Try anyway</Button>
            </div>
          </Empty>
        </div>
      )}
    </div>
  );
}
