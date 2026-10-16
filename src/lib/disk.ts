import { useSyncExternalStore } from 'react';
import YAML from 'yaml';
import { db, EMPTY_PROFILE } from './db';
import { desktop, type WorkspaceInfo, type WsFile } from './desktop';
import { STAGES, type Doc, type Job, type Profile } from './types';

/**
 * The workspace folder is where the user's data really lives in the desktop
 * app; IndexedDB is a cache of it, so every page keeps working the way it
 * does in the browser. Records go to readable files:
 *
 *   profile/about.md     name and contact (front matter)
 *   profile/career.md    the career record; rules.md, facts.md, style.md, notes.md
 *   jobs/<slug>/job.md   a job's details (front matter) and notes (body)
 *   jobs/<slug>/posting.md
 *   jobs/<slug>/resume.json + resume.css, letter.json + letter.css, answer-<slug>.md
 *   documents/…          documents not tied to a job
 *
 * Changes in the app are written out shortly after they happen, and changes
 * made to the files elsewhere are read back in.
 */

const PROFILE_TEXT = { history: 'career', rules: 'rules', facts: 'facts', style: 'style', notes: 'notes' } as const;
const ABOUT = ['name', 'headline', 'location', 'email', 'phone', 'links'] as const;
const JOB_KEYS = [
  'id', 'company', 'title', 'location', 'stage', 'url', 'website', 'portal', 'pay', 'payMin', 'payMax', 'remote', 'posted', 'moonshot', 'moonshotRank',
  'batch', 'verdict', 'strengths', 'gaps', 'flags', 'appliedAt', 'outcome', 'steps', 'log',
] as const;

const iso = (ms: number | undefined) => new Date(ms || Date.now()).toISOString();
const ms = (v: unknown) => (typeof v === 'string' ? Date.parse(v) || Date.now() : typeof v === 'number' ? v : Date.now());

function slug(s: string, max = 60) {
  const out = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return out.slice(0, max).replace(/-$/, '') || 'untitled';
}

function frontMatter(data: Record<string, unknown>, body = '') {
  const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)));
  return `---\n${YAML.stringify(clean, { lineWidth: 0 })}---\n${body ? `\n${body.trim()}\n` : ''}`;
}

function parseFrontMatter(text: string): { data: Record<string, unknown>; body: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: text };
  const data = YAML.parse(m[1]);
  return { data: data && typeof data === 'object' ? data : {}, body: m[2].trim() };
}

// --- Records to files ----------------------------------------------------------

/** Where each record lives in the folder: a job's folder, a document's path without its extension. */
const jobDir = new Map<string, string>();
const docBase = new Map<string, string>();

function freeName(want: string, taken: Iterable<string>) {
  const used = new Set(taken);
  if (!used.has(want)) return want;
  for (let i = 2; ; i++) if (!used.has(`${want}-${i}`)) return `${want}-${i}`;
}

function dirOf(job: Job) {
  let dir = jobDir.get(job.id);
  if (!dir) {
    dir = freeName(`jobs/${slug(`${job.company} ${job.title}`)}`, jobDir.values());
    jobDir.set(job.id, dir);
  }
  return dir;
}

function jobFiles(job: Job): WsFile[] {
  const dir = dirOf(job);
  const data: Record<string, unknown> = {};
  for (const k of JOB_KEYS) data[k] = job[k];
  data.created = iso(job.createdAt);
  data.updated = iso(job.updatedAt);
  const files = [{ path: `${dir}/job.md`, text: frontMatter(data, job.notes) }];
  if (job.description?.trim()) files.push({ path: `${dir}/posting.md`, text: `${job.description.trim()}\n` });
  return files;
}

async function baseOf(doc: Doc) {
  const job = doc.jobId ? await db.jobs.get(doc.jobId) : undefined;
  const dir = job ? dirOf(job) : 'documents';
  const have = docBase.get(doc.id);
  if (have && have.slice(0, have.lastIndexOf('/')) === dir) return { base: have };
  // "Resume (mechanical)" becomes resume-mechanical, not resume-resume-mechanical.
  const titled = `${doc.kind}-${slug(doc.title, 40).replace(new RegExp(`^(${doc.kind}|cover-letter)(-|$)`), '')}`.replace(/-$/, '');
  const name = job && doc.kind !== 'answer' ? doc.kind : titled;
  const base = freeName(`${dir}/${name}`, [...docBase.entries()].filter(([id]) => id !== doc.id).map(([, b]) => b));
  docBase.set(doc.id, base);
  return { base, moved: have };
}

function docFiles(doc: Doc, base: string): WsFile[] {
  const meta = { id: doc.id, kind: doc.kind, title: doc.title, variant: doc.variant, created: iso(doc.createdAt), updated: iso(doc.updatedAt) };
  if (doc.kind === 'answer') {
    const a = doc.data as { prompt?: string; text?: string };
    return [{ path: `${base}.md`, text: frontMatter({ ...meta, prompt: a.prompt }, a.text ?? '') }];
  }
  const files = [{ path: `${base}.json`, text: `${JSON.stringify({ ...meta, data: doc.data }, null, 2)}\n` }];
  if (doc.css?.trim()) files.push({ path: `${base}.css`, text: doc.css.endsWith('\n') ? doc.css : `${doc.css}\n` });
  return files;
}

const docPaths = (base: string) => [`${base}.json`, `${base}.css`, `${base}.md`];

function profileFiles(p: Profile): WsFile[] {
  const about: Record<string, unknown> = {};
  for (const k of ABOUT) about[k] = p[k];
  const files = [{ path: 'profile/about.md', text: frontMatter(about) }];
  for (const [key, name] of Object.entries(PROFILE_TEXT)) {
    files.push({ path: `profile/${name}.md`, text: `${(p[key as keyof typeof PROFILE_TEXT] ?? '').trim()}\n` });
  }
  return files;
}

// --- Files to records ----------------------------------------------------------

interface Parsed {
  jobs: Map<string, Job>;
  docs: Map<string, Doc>;
  profile: Profile | null;
  jobDir: Map<string, string>;
  docBase: Map<string, string>;
}

function parse(files: WsFile[]): Parsed {
  const byPath = new Map(files.map((f) => [f.path, f.text]));
  const out: Parsed = { jobs: new Map(), docs: new Map(), profile: null, jobDir: new Map(), docBase: new Map() };
  const jobIn = new Map<string, string>();

  for (const [p, text] of byPath) {
    const m = p.match(/^(jobs\/[^/]+)\/job\.md$/);
    if (!m) continue;
    try {
      const { data, body } = parseFrontMatter(text);
      if (typeof data.id !== 'string') continue;
      const job = { company: '', title: '', location: '', stage: 'saved' } as Job;
      for (const k of JOB_KEYS) if (data[k] !== undefined && data[k] !== null) (job as unknown as Record<string, unknown>)[k] = data[k];
      if (!STAGES.includes(job.stage)) job.stage = 'saved';
      job.notes = body || undefined;
      job.description = byPath.get(`${m[1]}/posting.md`)?.trim() || undefined;
      job.createdAt = ms(data.created);
      job.updatedAt = ms(data.updated);
      out.jobs.set(job.id, job);
      out.jobDir.set(job.id, m[1]);
      jobIn.set(m[1], job.id);
    } catch {
      // A half-saved or hand-broken file; the record stays as it was.
    }
  }

  for (const [p, text] of byPath) {
    const m = p.match(/^((jobs\/[^/]+|documents)\/[^/]+)\.(json|md)$/);
    if (!m || /\/(job|posting|README)\.md$/i.test(p)) continue;
    try {
      const raw = m[3] === 'json' ? JSON.parse(text) : parseFrontMatter(text);
      const meta = (m[3] === 'json' ? raw : raw.data) as Record<string, unknown>;
      if (typeof meta.id !== 'string' || !['resume', 'letter', 'answer'].includes(meta.kind as string)) continue;
      const kind = meta.kind as Doc['kind'];
      const doc: Doc = {
        id: meta.id,
        kind,
        title: String(meta.title ?? 'Untitled'),
        variant: typeof meta.variant === 'string' ? meta.variant : undefined,
        jobId: jobIn.get(m[2]),
        data: kind === 'answer' ? { prompt: meta.prompt as string | undefined, text: (raw as { body: string }).body } : (raw as { data: unknown }).data,
        css: kind === 'answer' ? undefined : byPath.get(`${m[1]}.css`) || undefined,
        createdAt: ms(meta.created),
        updatedAt: ms(meta.updated),
      };
      out.docs.set(doc.id, doc);
      out.docBase.set(doc.id, m[1]);
    } catch {
      // As above.
    }
  }

  if (byPath.has('profile/about.md') || byPath.has('profile/career.md')) {
    const p: Profile = { ...EMPTY_PROFILE };
    try {
      const { data } = parseFrontMatter(byPath.get('profile/about.md') ?? '');
      for (const k of ABOUT) if (data[k] !== undefined && data[k] !== null) (p as unknown as Record<string, unknown>)[k] = data[k];
    } catch {
      // As above.
    }
    for (const [key, name] of Object.entries(PROFILE_TEXT)) {
      const t = byPath.get(`profile/${name}.md`);
      if (t !== undefined) (p as unknown as Record<string, unknown>)[key] = t.trim();
    }
    out.profile = p;
  }
  return out;
}

// --- Keeping the two in step ------------------------------------------------------

type Table = 'jobs' | 'docs' | 'profile';
const dirty = new Map<string, { table: Table; id: string; gone?: boolean; label?: string }>();
let applying = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing: Promise<void> = Promise.resolve();

function mark(table: Table, id: string, change: { gone?: boolean; label?: string } = {}) {
  if (applying) return;
  dirty.set(`${table}:${id}`, { table, id, ...change });
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flush(), 400);
}

const label = (table: Table, rec: Partial<Job & Doc> | undefined) =>
  table === 'profile' ? 'profile' : table === 'jobs' ? `${rec?.company ?? ''}: ${rec?.title ?? ''}` : `${rec?.kind ?? 'document'} "${rec?.title ?? ''}"`;

/** Write what changed in the app to the folder. */
export function flush(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  flushing = flushing.then(async () => {
    const d = desktop();
    if (!d || !state.info?.root || !dirty.size) return;
    const batch = [...dirty.values()];
    dirty.clear();
    const files: WsFile[] = [];
    const remove: string[] = [];
    const said: string[] = [];
    for (const c of batch) {
      if (c.table === 'profile') {
        const p = await db.profile.get('me');
        if (p) files.push(...profileFiles(p));
        said.push('Updated your profile');
      } else if (c.table === 'jobs') {
        const job = c.gone ? undefined : await db.jobs.get(c.id);
        if (job) {
          const dir = dirOf(job);
          files.push(...jobFiles(job));
          if (!job.description?.trim()) remove.push(`${dir}/posting.md`);
          said.push(`Saved ${label('jobs', job)}`);
        } else if (jobDir.has(c.id)) {
          const dir = jobDir.get(c.id)!;
          remove.push(`${dir}/job.md`, `${dir}/posting.md`);
          jobDir.delete(c.id);
          said.push(`Deleted ${c.label ?? 'a job'}`);
        }
      } else {
        const doc = c.gone ? undefined : await db.docs.get(c.id);
        if (doc) {
          const { base, moved } = await baseOf(doc);
          const out = docFiles(doc, base);
          files.push(...out);
          for (const p of docPaths(base)) if (!out.some((f) => f.path === p)) remove.push(p);
          if (moved) remove.push(...docPaths(moved));
          said.push(`Saved ${label('docs', doc)}`);
        } else if (docBase.has(c.id)) {
          remove.push(...docPaths(docBase.get(c.id)!));
          docBase.delete(c.id);
          said.push(`Deleted ${c.label ?? 'a document'}`);
        }
      }
    }
    const message = said.length > 3 ? `${said.slice(0, 3).join('; ')} and ${said.length - 3} more` : said.join('; ');
    try {
      if (files.length) await d.workspace.write(files, message);
      if (remove.length) await d.workspace.remove(remove.filter((p) => !files.some((f) => f.path === p)), message);
    } catch (e) {
      // Leave them marked, so the next change tries again.
      for (const c of batch) dirty.set(`${c.table}:${c.id}`, c);
      console.error('Saving to the workspace failed', e);
    }
  });
  return flushing;
}

/** Everything in the app, as files, for a folder that's still empty. */
async function writeAll() {
  const d = desktop()!;
  const files: WsFile[] = [];
  const p = await db.profile.get('me');
  if (p) files.push(...profileFiles(p));
  for (const job of await db.jobs.toArray()) files.push(...jobFiles(job));
  for (const doc of await db.docs.toArray()) files.push(...docFiles(doc, (await baseOf(doc)).base));
  if (files.length) await d.workspace.write(files, 'Moved your job search into this folder');
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A job as the folder keeps it, for telling whether a file says something new. */
function jobSig(job: Job) {
  const data: Record<string, unknown> = {};
  for (const k of JOB_KEYS) data[k] = job[k];
  return [data, job.notes?.trim() || '', job.description?.trim() || '', iso(job.updatedAt)];
}

/** Make the cache match the folder. */
async function load() {
  const d = desktop()!;
  await flush();
  const parsed = parse(await d.workspace.readAll());
  jobDir.clear();
  docBase.clear();
  for (const [k, v] of parsed.jobDir) jobDir.set(k, v);
  for (const [k, v] of parsed.docBase) docBase.set(k, v);
  applying = true;
  try {
    await db.transaction('rw', db.jobs, db.docs, db.profile, async () => {
      const jobs = await db.jobs.toArray();
      const docs = await db.docs.toArray();
      const jobsOut = jobs.filter((j) => !parsed.jobs.has(j.id) && !dirty.has(`jobs:${j.id}`)).map((j) => j.id);
      const docsOut = docs.filter((x) => !parsed.docs.has(x.id) && !dirty.has(`docs:${x.id}`)).map((x) => x.id);
      const have = new Map<string, unknown>([...jobs.map((j) => [`j:${j.id}`, j] as const), ...docs.map((x) => [`d:${x.id}`, x] as const)]);
      await db.jobs.bulkDelete(jobsOut);
      await db.docs.bulkDelete(docsOut);
      // Fields the folder doesn't keep, such as an old base flag, don't count as a change.
      await db.jobs.bulkPut([...parsed.jobs.values()].filter((j) => {
        const prev = have.get(`j:${j.id}`) as Job | undefined;
        return !prev || !same(jobSig(j), jobSig(prev));
      }));
      await db.docs.bulkPut([...parsed.docs.values()].filter((x) => {
        const prev = have.get(`d:${x.id}`) as Doc | undefined;
        return !prev || !same(docFiles(x, ''), docFiles({ ...prev, jobId: x.jobId }, '')) || prev.jobId !== x.jobId;
      }));
      if (parsed.profile) {
        const prev = await db.profile.get('me');
        if (!prev || !same(profileFiles(parsed.profile), profileFiles(prev))) await db.profile.put({ ...prev, ...parsed.profile });
      }
    });
  } finally {
    applying = false;
  }
}

// --- Setup ----------------------------------------------------------------------

interface DiskState {
  info: WorkspaceInfo | null;
  ready: boolean;
  error?: string;
}

let state: DiskState = { info: null, ready: false };
const listeners = new Set<() => void>();
function set(patch: Partial<DiskState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useDisk(): DiskState {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  );
}

/** Records from when the app was called Offerdex, taken in once. */
async function takeLegacy() {
  const d = desktop()!;
  const old = await d.legacy.data();
  if (!old) return;
  if (!(await db.jobs.count()) && !(await db.docs.count()) && !(await db.profile.count())) {
    await db.transaction('rw', [db.jobs, db.docs, db.chats, db.profile, db.settings, db.files], async () => {
      const tables = { jobs: db.jobs, docs: db.docs, chats: db.chats, profile: db.profile, settings: db.settings, files: db.files } as const;
      for (const [name, table] of Object.entries(tables)) {
        const rows = old[name];
        if (Array.isArray(rows) && rows.length) await (table as typeof db.jobs).bulkPut(rows as Job[]);
      }
    });
  }
  await d.legacy.taken();
}

let started = false;

/** Start keeping the cache and the folder in step. Desktop only; the browser keeps IndexedDB alone. */
export async function startDisk() {
  const d = desktop();
  if (!d || started) return;
  started = true;
  db.jobs.hook('creating', function (id, obj) { this.onsuccess = () => mark('jobs', String(id ?? obj.id)); });
  db.jobs.hook('updating', function (_m, id) { this.onsuccess = () => mark('jobs', String(id)); });
  db.jobs.hook('deleting', function (id, obj) { this.onsuccess = () => mark('jobs', String(id), { gone: true, label: label('jobs', obj) }); });
  db.docs.hook('creating', function (id, obj) { this.onsuccess = () => mark('docs', String(id ?? obj.id)); });
  db.docs.hook('updating', function (_m, id) { this.onsuccess = () => mark('docs', String(id)); });
  db.docs.hook('deleting', function (id, obj) { this.onsuccess = () => mark('docs', String(id), { gone: true, label: label('docs', obj) }); });
  db.profile.hook('creating', function () { this.onsuccess = () => mark('profile', 'me'); });
  db.profile.hook('updating', function () { this.onsuccess = () => mark('profile', 'me'); });

  d.workspace.onChanged(() => void load().catch((e) => set({ error: String(e?.message ?? e) })));
  window.addEventListener('beforeunload', () => void flush());

  try {
    await takeLegacy();
    const info = await d.workspace.info();
    set({ info });
    if (info.root) await connect();
  } catch (e) {
    set({ error: String((e as Error).message ?? e) });
  } finally {
    set({ ready: true });
  }
}

/** Read the folder in, or fill it from the app when it has nothing yet. */
async function connect() {
  const d = desktop()!;
  const files = await d.workspace.readAll();
  const hasRecords = files.some((f) => /^(profile|jobs|documents)\//.test(f.path));
  if (hasRecords) await load();
  else await writeAll();
}

/** Use a workspace folder: the default one, or one the user picks. */
export async function chooseWorkspace(pick: boolean) {
  const d = desktop();
  if (!d) return;
  await flush();
  const first = !state.info?.root;
  const info = pick ? await d.workspace.choose() : await d.workspace.useDefault();
  if (!info) return;
  jobDir.clear();
  docBase.clear();
  set({ info });
  // The first folder picked may already hold files; what's only in the app goes into it too.
  const parsed = first ? parse(await d.workspace.readAll()) : null;
  if (parsed && (parsed.jobs.size || parsed.docs.size || parsed.profile)) {
    for (const j of await db.jobs.toArray()) if (!parsed.jobs.has(j.id)) mark('jobs', j.id);
    for (const x of await db.docs.toArray()) if (!parsed.docs.has(x.id)) mark('docs', x.id);
    if (!parsed.profile && (await db.profile.get('me'))) mark('profile', 'me');
    for (const [k, v] of parsed.jobDir) jobDir.set(k, v);
    for (const [k, v] of parsed.docBase) docBase.set(k, v);
  }
  await connect();
}
