import { unzipSync, strFromU8 } from 'fflate';
import { db, now, SAMPLE_ID } from './db';
import { adoptBaseResumes } from './career';
import type { Chat, Doc, Job, Profile, Settings, SourceFile, Stage } from './types';

/**
 * Importers for the files a job search usually already has: an Offerdex
 * backup, an ai-job-search `seen_jobs.json`, or a tracker CSV.
 */

export interface ImportResult {
  jobs: number;
  docs: number;
  other: string[];
  /** Files kept for the assistant to read, for uploads that bring more than data. */
  files?: { bundle: string; stored: number; unread: string[] };
}

type SeenEntry = {
  portal?: string;
  id?: string;
  company?: string;
  title?: string;
  location?: string;
  url?: string;
  pay?: string;
  salary_min?: number;
  salary_max?: number;
  posted?: string;
  first_seen?: string;
  status?: string;
  rank_verdict?: string;
  strengths?: string[];
  gaps?: string[];
  moonshot_rank?: number;
  apply_batch?: string;
  deadline?: string | null;
};

function stageFromSeen(e: SeenEntry): Stage {
  const verdict = e.rank_verdict ?? '';
  if (e.status === 'applied') return 'applied';
  if (e.status === 'expired' || verdict.startsWith('skip')) return 'closed';
  if (e.apply_batch) return 'next';
  if (verdict === 'saved by user' || verdict === 'moonshot' || e.status === 'shortlisted') return 'saved';
  return 'inbox';
}

function fromSeen(key: string, e: SeenEntry): Job {
  const verdict = e.rank_verdict ?? undefined;
  return {
    id: key,
    portal: e.portal,
    company: e.company ?? '',
    title: e.title ?? '',
    location: e.location ?? '',
    url: e.url,
    pay: e.pay ?? (e.salary_min && e.salary_max ? `$${Math.round(e.salary_min / 1000)}k–$${Math.round(e.salary_max / 1000)}k` : undefined),
    payMin: e.salary_min,
    payMax: e.salary_max,
    posted: e.posted,
    stage: stageFromSeen(e),
    moonshot: verdict === 'moonshot' || undefined,
    moonshotRank: e.moonshot_rank,
    batch: e.apply_batch,
    strengths: e.strengths,
    gaps: e.gaps,
    verdict,
    createdAt: e.first_seen ? Date.parse(e.first_seen) : now(),
    updatedAt: now(),
  };
}

/** Minimal RFC 4180 CSV parser: quoted fields, escaped quotes, newlines in quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim()));
}

const TRACKER_STAGE: Record<string, Stage> = {
  drafted: 'next', ready: 'next', applied: 'applied', interviewing: 'interviewing', interview: 'interviewing',
  offer: 'offer', rejected: 'closed', withdrawn: 'closed', hired: 'closed',
};

async function mergeJob(job: Job) {
  const prev = await db.jobs.get(job.id);
  // Never move a listing backwards, and keep what the user already wrote.
  const order = ['inbox', 'saved', 'next', 'applied', 'interviewing', 'offer', 'closed'];
  const stage = prev && order.indexOf(prev.stage) > order.indexOf(job.stage) ? prev.stage : job.stage;
  await db.jobs.put({ ...job, ...prev, ...Object.fromEntries(Object.entries(job).filter(([, v]) => v !== undefined)), stage, notes: job.notes ?? prev?.notes, createdAt: prev?.createdAt ?? job.createdAt });
}

/** Import one file: a zip bundle, or a single backup, seen_jobs.json or tracker CSV. */
export async function importFile(file: File): Promise<ImportResult> {
  if (/\.zip$/i.test(file.name)) return importZip(file.name, new Uint8Array(await file.arrayBuffer()));
  return importText(file.name, await file.text());
}

const TEXT = /\.(md|markdown|txt|json|csv|tsv|tsx|ts|jsx|js|html?|css|xml|ya?ml|toml|tex|cls|py|ini|log)$/i;

/** Which structured importer, if any, understands this file. */
function recognize(name: string, text: string): 'backup' | 'seen' | 'tracker' | null {
  if (/\.csv$/i.test(name)) return /(^|,)company(,|$)/.test(text.split(/\r?\n/, 1)[0]) && /(^|,)role(,|$)/.test(text.split(/\r?\n/, 1)[0]) ? 'tracker' : null;
  if (!/\.json$/i.test(name)) return null;
  try {
    const data = JSON.parse(text);
    if (data?.app === 'offerdex') return 'backup';
    const seen = data?.seen ?? data;
    const values = seen && typeof seen === 'object' && !Array.isArray(seen) ? Object.values(seen) : [];
    if (values.length && values.every((v) => v && typeof v === 'object' && 'title' in v && 'company' in v)) return 'seen';
  } catch {
    // Not JSON after all; the assistant can still read it.
  }
  return null;
}

/**
 * A zip of whatever a search has accumulated. Structured files import
 * directly, in an order that lets later ones attach to earlier ones (a
 * backup's profile, then listings, then the tracker that refers to them).
 * Every file is kept so the assistant can read the rest and fill in what no
 * importer understands.
 */
export async function importZip(name: string, bytes: Uint8Array): Promise<ImportResult> {
  const entries = unzipSync(bytes);
  const bundle = name.replace(/\.zip$/i, '');
  const files: SourceFile[] = [];
  const unread: string[] = [];
  for (const [rawPath, data] of Object.entries(entries)) {
    if (rawPath.endsWith('/') || /(^|\/)(__MACOSX|\.DS_Store)/.test(rawPath)) continue;
    const path = rawPath;
    const isText = TEXT.test(path);
    if (!isText) unread.push(path);
    files.push({ id: `${bundle}/${path}`, bundle, path, size: data.length, text: isText ? strFromU8(data) : undefined, createdAt: now() });
  }
  // Drop a single top-level folder so paths read "profile/x.md", not "bundle/profile/x.md".
  const prefix = commonFolder(files.map((f) => f.path));
  for (const f of files) {
    f.path = f.path.slice(prefix.length);
    f.id = `${bundle}/${f.path}`;
  }

  const result: ImportResult = { jobs: 0, docs: 0, other: [], files: { bundle, stored: files.length, unread: unread.map((p) => p.slice(prefix.length)) } };
  const order = { backup: 0, seen: 1, tracker: 2 } as const;
  const structured = files
    .map((f) => ({ f, kind: f.text ? recognize(f.path, f.text) : null }))
    .filter((x): x is { f: SourceFile; kind: keyof typeof order } => !!x.kind)
    .sort((a, b) => order[a.kind] - order[b.kind]);
  for (const { f } of structured) {
    const r = await importText(f.path, f.text!);
    result.jobs += r.jobs;
    result.docs += r.docs;
    result.other.push(...r.other);
    f.status = `imported${r.jobs ? ` ${r.jobs} listings` : ''}${r.docs ? ` ${r.docs} documents` : ''}${r.other.length ? ` ${r.other.join(', ')}` : ''}`;
  }
  await db.files.bulkPut(files);
  return result;
}

function commonFolder(paths: string[]): string {
  const first = paths[0]?.split('/')[0];
  return first && paths.length > 1 && paths.every((p) => p.startsWith(`${first}/`)) ? `${first}/` : '';
}

export async function importText(name: string, text: string): Promise<ImportResult> {
  const result: ImportResult = { jobs: 0, docs: 0, other: [] };

  if (/\.csv$/i.test(name)) {
    const [header, ...rows] = parseCsv(text);
    const col = (name: string) => header.indexOf(name);
    for (const r of rows) {
      const company = r[col('company')]?.trim();
      const role = r[col('role')]?.trim();
      if (!company || !role) continue;
      const source = r[col('source')]?.trim();
      const sameUrl = (u?: string) => !!u && !!source && u.replace(/\/+$/, '').toLowerCase() === source.replace(/\/+$/, '').toLowerCase();
      const all = await db.jobs.toArray();
      const existing =
        all.find((j) => sameUrl(j.url)) ??
        all.find((j) => j.company.toLowerCase() === company.toLowerCase() && j.title.toLowerCase() === role.toLowerCase());
      const status = r[col('status')]?.trim().toLowerCase() ?? '';
      const date = r[col('date')]?.trim();
      await mergeJob({
        id: existing?.id ?? `tracker:${company.toLowerCase().replace(/\W+/g, '-')}:${role.toLowerCase().replace(/\W+/g, '-')}`,
        company,
        title: role,
        location: existing?.location ?? '',
        url: existing?.url ?? (source?.startsWith('http') ? source : undefined),
        stage: TRACKER_STAGE[status] ?? existing?.stage ?? 'saved',
        appliedAt: status === 'applied' ? date : existing?.appliedAt,
        notes: existing?.notes?.includes(r[col('notes')] ?? '') ? existing.notes : [existing?.notes, r[col('notes')]].filter(Boolean).join('\n\n') || undefined,
        createdAt: date ? Date.parse(date) || now() : now(),
        updatedAt: now(),
      });
      result.jobs++;
    }
    return result;
  }

  const data = JSON.parse(text);

  if (data?.app === 'offerdex') {
    await db.transaction('rw', [db.jobs, db.docs, db.chats, db.profile, db.settings, db.files], async () => {
      for (const j of (data.jobs ?? []) as Job[]) { await db.jobs.put(j); result.jobs++; }
      for (const d of (data.docs ?? []) as Doc[]) { await db.docs.put(d); result.docs++; }
      // Drop the starter resume once real ones arrive, unless it was edited.
      if (result.docs && (await db.docs.get(SAMPLE_ID))?.updatedAt === 0) await db.docs.delete(SAMPLE_ID);
      for (const c of (data.chats ?? []) as Chat[]) await db.chats.put(c);
      for (const p of (data.profile ?? []) as Profile[]) { await db.profile.put(p); result.other.push('profile'); }
      for (const f of (data.files ?? []) as SourceFile[]) await db.files.put(f);
      for (const s of (data.settings ?? []) as Settings[]) {
        // Backups carry no API keys; keep the ones already on this device.
        const prev = await db.settings.get('settings');
        const keys = new Map(prev?.providers.map((p) => [p.id, p.apiKey]));
        await db.settings.put({ ...s, providers: s.providers.map((p) => ({ ...p, apiKey: p.apiKey ?? keys.get(p.id) })) });
      }
    });
    // A backup from before the career record brings base resumes instead.
    await adoptBaseResumes();
    return result;
  }

  // ai-job-search seen_jobs.json: { "<portal>:<id>": {...} } or { seen: {...} }
  const seen = (data?.seen ?? data) as Record<string, SeenEntry>;
  if (seen && typeof seen === 'object' && Object.values(seen).every((v) => v && typeof v === 'object' && 'title' in v)) {
    for (const [key, e] of Object.entries(seen)) {
      await mergeJob(fromSeen(key, e));
      result.jobs++;
    }
    return result;
  }

  throw new Error('Unrecognized file. Expected an Offerdex backup, a seen_jobs.json, or a tracker CSV.');
}
