/**
 * Public job-board APIs that allow browser requests (CORS `*`):
 * Greenhouse, Ashby and Lever. Boards are cached for ten minutes.
 */

export type Ats = 'greenhouse' | 'ashby' | 'lever';

export interface Posting {
  ats: Ats;
  board: string;
  id: string;
  title: string;
  location: string;
  url: string;
  pay?: string;
  payMin?: number;
  payMax?: number;
  remote?: boolean;
  department?: string;
  posted?: string;
  /** Plain text, only filled in by `getPosting`. */
  text?: string;
}

const cache = new Map<string, { at: number; raw: unknown }>();

async function getJson(url: string): Promise<unknown> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.raw;
  const res = await fetch(url);
  if (res.status === 404) throw new Error(`Board not found: ${url}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${url}`);
  const raw = await res.json();
  cache.set(url, { at: Date.now(), raw });
  return raw;
}

export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // Greenhouse double-escapes its content.
  const inner = doc.body.textContent ?? '';
  const twice = /<\w+[^>]*>/.test(inner) ? new DOMParser().parseFromString(inner, 'text/html') : doc;
  twice.querySelectorAll('li').forEach((li) => li.prepend('• '));
  twice.querySelectorAll('p, li, h1, h2, h3, h4, br, div').forEach((el) => el.append('\n'));
  return (twice.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
}

const k = (n: number) => `$${Math.round(n / 1000)}k`;

/** Find the first "$120,000 – $180,000" style range in posting text. */
export function findPayRange(text: string): Pick<Posting, 'pay' | 'payMin' | 'payMax'> {
  const m = text.match(/\$\s?(\d{2,3}),(\d{3})(?:\.\d\d)?\s*(?:USD)?\s*(?:[—–-]|to)\s*\$\s?(\d{2,3}),(\d{3})/);
  if (!m) return {};
  const payMin = Number(m[1] + m[2]);
  const payMax = Number(m[3] + m[4]);
  return { payMin, payMax, pay: `${k(payMin)}–${k(payMax)}` };
}

type Gh = { jobs: { id: number; title: string; absolute_url: string; location: { name: string }; updated_at?: string; first_published?: string; content?: string; departments?: { name: string }[] }[] };
type Ashby = { jobs: { id: string; title: string; location: string; isRemote?: boolean; jobUrl: string; department?: string; publishedAt?: string; descriptionPlain?: string; compensation?: { compensationTierSummary?: string; summaryComponents?: { compensationType: string; minValue?: number; maxValue?: number }[] } }[] };
type Lever = { id: string; text: string; hostedUrl: string; categories?: { location?: string; team?: string; commitment?: string }; workplaceType?: string; createdAt?: number; descriptionPlain?: string; additionalPlain?: string; lists?: { text: string; content: string }[]; salaryRange?: { min: number; max: number; currency: string; interval: string } }[];

export async function listBoard(ats: Ats, board: string, withText = false): Promise<Posting[]> {
  if (ats === 'greenhouse') {
    const d = (await getJson(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`)) as Gh;
    return d.jobs.map((j) => {
      const text = j.content ? htmlToText(j.content) : '';
      return {
        ats, board,
        id: String(j.id),
        title: j.title.trim(),
        location: j.location?.name ?? '',
        url: j.absolute_url,
        department: j.departments?.[0]?.name,
        posted: (j.first_published ?? j.updated_at)?.slice(0, 10),
        remote: /remote/i.test(j.location?.name ?? ''),
        ...findPayRange(text),
        ...(withText ? { text } : {}),
      };
    });
  }
  if (ats === 'ashby') {
    const d = (await getJson(`https://api.ashbyhq.com/posting-api/job-board/${board}?includeCompensation=true`)) as Ashby;
    return d.jobs.map((j) => {
      const salary = j.compensation?.summaryComponents?.find((c) => c.compensationType === 'Salary');
      return {
        ats, board,
        id: j.id,
        title: j.title.trim(),
        location: j.location,
        url: j.jobUrl,
        department: j.department,
        posted: j.publishedAt?.slice(0, 10),
        remote: j.isRemote,
        pay: j.compensation?.compensationTierSummary,
        payMin: salary?.minValue,
        payMax: salary?.maxValue,
        ...(withText ? { text: j.descriptionPlain } : {}),
      };
    });
  }
  const d = (await getJson(`https://api.lever.co/v0/postings/${board}?mode=json`)) as Lever;
  return d.map((j) => ({
    ats, board,
    id: j.id,
    title: j.text.trim(),
    location: j.categories?.location ?? '',
    url: j.hostedUrl,
    department: j.categories?.team,
    posted: j.createdAt ? new Date(j.createdAt).toISOString().slice(0, 10) : undefined,
    remote: j.workplaceType === 'remote',
    ...(j.salaryRange
      ? { payMin: j.salaryRange.min, payMax: j.salaryRange.max, pay: `${k(j.salaryRange.min)}–${k(j.salaryRange.max)} ${j.salaryRange.interval}` }
      : {}),
    ...(withText
      ? { text: [j.descriptionPlain, ...(j.lists ?? []).map((l) => `${l.text}\n${htmlToText(l.content)}`), j.additionalPlain].filter(Boolean).join('\n\n') }
      : {}),
  }));
}

export async function getPosting(ats: Ats, board: string, id: string): Promise<Posting> {
  const all = await listBoard(ats, board, true);
  const p = all.find((j) => j.id === id || j.id.startsWith(id));
  if (!p) throw new Error(`No posting ${id} on ${ats}:${board}. It may have closed.`);
  if (!p.pay && p.text) Object.assign(p, findPayRange(p.text));
  return p;
}

/** Recognize a posting URL so a pasted link can be imported in one step. */
export function parsePostingUrl(url: string): { ats: Ats; board: string; id: string } | null {
  let m = url.match(/greenhouse\.io\/(?:embed\/job_app\?for=)?([\w-]+)\/jobs\/(\d+)/) ?? url.match(/greenhouse\.io\/embed\/job_app\?for=([\w-]+)&token=(\d+)/);
  if (m) return { ats: 'greenhouse', board: m[1], id: m[2] };
  m = url.match(/jobs\.ashbyhq\.com\/([\w.-]+)\/([0-9a-f-]{36})/);
  if (m) return { ats: 'ashby', board: m[1], id: m[2] };
  m = url.match(/jobs\.lever\.co\/([\w.-]+)\/([0-9a-f-]{36})/);
  if (m) return { ats: 'lever', board: m[1], id: m[2] };
  return null;
}
