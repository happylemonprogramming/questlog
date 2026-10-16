import { useSyncExternalStore } from 'react';
import { db, getProfile, moveJob, now } from './db';
import { desktop, type FormField } from './desktop';
import { applicationPage, openApplication } from './workspace';
import type { Application, Doc, FormAnswer, Job } from './types';

/**
 * Turning in an application that was prepared ahead. The guide fills the
 * employer's form once and Questlog keeps what it put there, question by
 * question; the user reads it all in Questlog, and when they press Submit the
 * answers go back into a fresh copy of the form and the form is sent. Only
 * that press sends anything: no agent tool reaches the submit button.
 */

const norm = (s: string) => s.toLowerCase().replace(/\(required\)|\*/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && !v.length);

/** Whether an answer still needs the user: empty, and either asked of them or required, with no document to put there. */
export const needsYou = (a: FormAnswer) => isEmpty(a.value) && !a.docId && (!!a.ask || !!a.required);

export const answerText = (v: FormAnswer['value']) => (Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v);

export type Readiness = 'none' | 'needs-you' | 'ready';

export function readiness(job: Job): Readiness {
  const a = job.application;
  if (!a) return 'none';
  return a.answers.some(needsYou) ? 'needs-you' : 'ready';
}

/** The file name an upload gets: "Ada_Lovelace_Resume_Anthropic.pdf". */
export async function uploadName(docId: string) {
  const [doc, profile] = await Promise.all([db.docs.get(docId), getProfile()]);
  if (!doc) return undefined;
  const job = doc.jobId ? await db.jobs.get(doc.jobId) : undefined;
  const name = profile.name || (doc.data as { header?: { name?: string } }).header?.name || '';
  const parts = [name, doc.kind === 'letter' ? 'Cover Letter' : 'Resume', job?.company.replace(/\s*\(.*\)/, '')].filter(Boolean);
  return parts.join(' ').replace(/\s+/g, '_');
}

const isLetterField = (label: string) => /cover/i.test(label);

async function docsFor(jobId: string) {
  const docs = await db.docs.where('jobId').equals(jobId).toArray();
  const latest = (kind: Doc['kind']) => docs.filter((d) => d.kind === kind).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return { resume: latest('resume'), letter: latest('letter') };
}

// --- Keeping what the guide filled in ---------------------------------------------

/**
 * Read the open form and keep its answers on the job. A form with several
 * pages is saved a page at a time; a later page adds to the earlier ones.
 */
export async function saveApplication(jobId: string, opts: { step?: number; ask?: { label: string; why: string }[]; note?: string }) {
  const d = desktop();
  if (!d) throw new Error('Only the desktop app can read application forms.');
  const job = await db.jobs.get(jobId);
  if (!job) throw new Error(`No listing ${jobId}.`);
  const form = await d.form.read();
  const { resume, letter } = await docsFor(jobId);
  const step = opts.step ?? 1;

  const answers: FormAnswer[] = form.fields
    .filter((f) => f.label && (!isEmpty(f.value) || f.required || f.kind === 'file'))
    .map((f) => {
      const a: FormAnswer = { label: f.label, kind: f.kind, value: value(f), step };
      if (f.required) a.required = true;
      if (f.options?.length) a.options = f.options.slice(0, 80);
      if (f.kind === 'file') {
        const doc = isLetterField(f.label) ? letter : resume;
        if (doc) a.docId = doc.id;
      }
      return a;
    })
    // An optional upload with nothing for it is just noise.
    .filter((a) => a.kind !== 'file' || a.docId || a.required || !isEmpty(a.value));

  for (const { label, why } of opts.ask ?? []) {
    const n = norm(label);
    const hit = answers.find((a) => norm(a.label) === n) ?? answers.find((a) => norm(a.label).includes(n) || n.includes(norm(a.label)));
    if (hit) hit.ask = why;
    else answers.push({ label, kind: 'text', value: '', required: true, ask: why, step });
  }

  const prev = job.application;
  const kept = prev ? prev.answers.filter((a) => (a.step ?? 1) !== step && !answers.some((b) => norm(b.label) === norm(a.label))) : [];
  const application: Application = {
    url: prev?.url ?? form.url,
    answers: [...kept, ...answers].sort((a, b) => (a.step ?? 1) - (b.step ?? 1)),
    note: opts.note ?? prev?.note,
    preparedAt: new Date().toISOString(),
  };
  await db.jobs.update(jobId, { application, updatedAt: now() });
  return { application, form };
}

function value(f: FormField): FormAnswer['value'] {
  const v = f.value;
  if (typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.map(String);
  const s = typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v);
  // An empty dropdown reads as its placeholder.
  if ((f.kind === 'combobox' || f.kind === 'select') && /^(please )?(select|choose)\b[^]{0,30}$|^-+$/i.test(s.trim())) return '';
  return s;
}

/** Change one answer, from the review. */
export async function setAnswer(job: Job, index: number, v: FormAnswer['value']) {
  if (!job.application) return;
  const answers = job.application.answers.map((a, i) => (i === index ? { ...a, value: v } : a));
  await db.jobs.update(job.id, { application: { ...job.application, answers }, updatedAt: now() });
}

// --- Putting it back into the form ----------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const host = (u: string) => {
  try {
    return new URL(u).hostname;
  } catch {
    return '';
  }
};

/** Wait for the form to load in the Apply pane, and for its fields to appear. */
async function waitForForm(url: string) {
  const d = desktop()!;
  await sleep(600);
  const deadline = Date.now() + 25_000;
  for (;;) {
    const s = await d.form.status();
    if (s.open && !s.loading && s.url && host(s.url) === host(url)) break;
    if (Date.now() > deadline) throw new Error('The form didn’t load.');
    await sleep(300);
  }
  const until = Date.now() + 10_000;
  for (;;) {
    const f = await d.form.read();
    if (f.fields.length || Date.now() > until) return f;
    await sleep(700);
  }
}

const same = (a: unknown, b: unknown) => norm(String(Array.isArray(a) ? a.join(',') : a ?? '')) === norm(String(Array.isArray(b) ? b.join(',') : b ?? ''));

/** Fill the fields on the page now from the answers, once each. Returns the labels it couldn't fill. */
async function fillPage(job: Job, app: Application, used: Set<number>) {
  const d = desktop()!;
  const form = await d.form.read();
  const { resume, letter } = await docsFor(job.id);
  const fills: { ref: string; value: unknown; label: string }[] = [];
  const missed: string[] = [];

  for (const f of form.fields) {
    const n = norm(f.label);
    const pick = (match: (a: FormAnswer) => boolean) => app.answers.findIndex((a, i) => !used.has(i) && norm(a.label) === n && match(a));
    let i = pick((a) => a.kind === f.kind);
    if (i < 0) i = pick(() => true);
    if (i < 0) continue;
    used.add(i);
    const a = app.answers[i];
    if (f.kind === 'file') {
      const docId = a.docId ?? (isLetterField(f.label) ? letter : resume)?.id;
      if (!docId || !isEmpty(f.value)) continue;
      const r = await d.form.attach(f.ref, docId, await uploadName(docId));
      if (!r.ok) missed.push(f.label);
      continue;
    }
    if (isEmpty(a.value) || same(f.value, a.value)) continue;
    fills.push({ ref: f.ref, value: a.value, label: f.label });
  }
  if (fills.length) {
    const res = await d.form.fill(fills.map(({ ref, value }) => ({ ref, value })));
    for (const r of res) if (!r.ok) missed.push(fills.find((x) => x.ref === r.ref)?.label ?? r.ref);
  }
  return missed;
}

const SENT = /thank(s| you)\b.{0,80}\b(appl|submi|interest)|application (has been |was )?(received|submitted|sent)|we('ve| have) received your|successfully (submitted|applied)|you('ve| have) (successfully )?applied/i;
const HUMAN = /captcha|verify (that )?you('re| are) (a )?human|are you a robot|security check/i;
const STEP_BUTTON = /^(next|continue|save (and|&) continue|proceed)\b/i;

export type Phase = 'opening' | 'filling' | 'checking' | 'sending' | 'sent' | 'stopped' | 'unsure';

export interface TurnIn {
  jobId: string;
  phase: Phase;
  /** What's happening, or why it stopped. */
  detail?: string;
  /** Questions on the form that are still empty or didn't take. */
  issues?: string[];
}

let state: TurnIn | null = null;
const listeners = new Set<() => void>();
function set(next: TurnIn | null) {
  state = next;
  listeners.forEach((l) => l());
}

export function useTurnIn(): TurnIn | null {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  );
}

export const clearTurnIn = () => set(null);

/** The user says it went through, after a send Questlog couldn't confirm. */
export async function confirmSent(job: Job) {
  await moveJob(job, 'applied', 'Turned in from Questlog');
  set({ jobId: job.id, phase: 'sent', detail: 'Turned in' });
}

/**
 * Send a prepared application: open its form, fill it from the answers page
 * by page, check nothing required is empty, and press submit. Stops before
 * sending if anything is off, with the form open so the user can see it;
 * `anyway` sends regardless. Runs only from the user's own press.
 */
export async function turnIn(job: Job, { anyway = false } = {}) {
  const d = desktop();
  const app = job.application;
  const page = applicationPage(job);
  if (!d || !app || !page) return;
  const update = (patch: Omit<TurnIn, 'jobId'>) => set({ jobId: job.id, ...patch });

  try {
    if (!anyway) {
      update({ phase: 'opening', detail: 'Opening the form' });
      openApplication(job.id);
      await waitForForm(page.url);

      const used = new Set<number>();
      const missed: string[] = [];
      const steps = Math.max(1, ...app.answers.map((a) => a.step ?? 1));
      for (let step = 1; ; step++) {
        update({ phase: 'filling', detail: steps > 1 ? `Filling in page ${step} of ${steps}` : 'Filling in your answers' });
        missed.push(...(await fillPage(job, app, used)));
        const form = await d.form.read();
        if (form.buttons.some((b) => b.submits) || step >= steps + 1) break;
        const next = form.buttons.find((b) => STEP_BUTTON.test(b.text));
        if (!next) break;
        await d.form.click(next.ref);
        await sleep(1500);
      }

      update({ phase: 'checking', detail: 'Checking every required question has an answer' });
      await sleep(400);
      const form = await d.form.read();
      const empty = form.fields.filter((f) => f.required && isEmpty(f.value)).map((f) => f.label || 'A question with no label');
      const issues = [...new Set([...missed, ...empty])];
      if (issues.length) {
        update({ phase: 'stopped', detail: issues.length === 1 ? 'One question needs a look before it can go.' : `${issues.length} questions need a look before it can go.`, issues });
        return;
      }
    }

    update({ phase: 'sending', detail: 'Sending' });
    const r = await d.form.submit();
    if (!r.ok) {
      update({ phase: 'stopped', detail: r.note ?? 'Couldn’t press submit.' });
      return;
    }
    await sleep(3500);
    const after = await d.form.text().catch(() => ({ text: '', url: '', title: '' }));
    if (SENT.test(after.text)) {
      await moveJob(job, 'applied', 'Turned in from Questlog');
      update({ phase: 'sent', detail: 'Turned in' });
      return;
    }
    if (HUMAN.test(after.text)) {
      update({ phase: 'stopped', detail: 'The site wants to check you’re a person. Do that on the form, then press its submit button.' });
      return;
    }
    const form = await d.form.read().catch(() => null);
    const empty = form?.fields.filter((f) => f.required && isEmpty(f.value)).map((f) => f.label) ?? [];
    if (empty.length) {
      update({ phase: 'stopped', detail: 'The form sent it back. These need an answer:', issues: empty });
      return;
    }
    update({ phase: 'unsure', detail: `Pressed “${r.label}”. Did it go through?` });
  } catch (e) {
    update({ phase: 'stopped', detail: (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') });
  }
}

/** The quests lined up, in camp's order: by batch, then as they were added. */
export function upNext(jobs: Job[]): Job[] {
  const batches = new Map<string, Job[]>();
  for (const j of jobs) if (j.stage === 'next') batches.set(j.batch || '', [...(batches.get(j.batch || '') ?? []), j]);
  return [...batches.values()].flat();
}

/** Ask the system to say when a long job is done, if the user has looked away. */
export function wantNotice() {
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission();
}

/** What to ask the guide to get quests ready to send. */
export function prepPrompt(jobs: Job[]) {
  const list = jobs.map((j) => `- ${j.company}: ${j.title} (listing ${j.id})`).join('\n');
  if (!desktop()) {
    return `Get these ${jobs.length === 1 ? 'quest' : `${jobs.length} quests`} ready to apply to, one at a time: make my resume for each one that doesn't have one yet, written from my career record and designed for the company, and a cover letter where the posting asks for one.\n\n${list}\n\nTell me when they're all done.`;
  }
  return `Get these ${jobs.length === 1 ? 'quest' : `${jobs.length} quests`} ready for me to submit, one at a time:\n\n${list}\n\nFor each: make my resume for it if it doesn't have one (written from my career record, designed for the company), and a cover letter if the form asks for one. Then open_application, read_form, fill in everything you can answer truthfully, attach the resume, and step through any further pages without submitting. On each page, call save_application, listing the questions you left for me and why. Don't submit anything. When they're all done, tell me which are ready and which have questions for me.`;
}
