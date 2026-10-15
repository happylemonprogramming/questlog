import { defineTool, type Tool } from '@porygon/core';
import { z } from 'zod';
import { db, getProfile, logJob, now, today, uid, upsertJob } from '@/lib/db';
import { getPosting, listBoard, parsePostingUrl, type Ats } from '@/lib/boards';
import { STAGES, type Doc, type Job } from '@/lib/types';
import type { LetterData, ResumeData } from '@/lib/sheet';
import { measureSheet } from '@/lib/measure';
import { letterSchema, resumeSchema } from '@/lib/sheetSchema';
import { cleanCss, designOf, inheritedDesign, MARKUP_GUIDE } from '@/lib/design';
import { companyDomain, normalizeWebsite } from '@/lib/logo';
import { formTools } from './formTools';

const json = (v: unknown) => JSON.stringify(v, null, 1);

/** A listing as the model sees it in lists: enough to decide, nothing more. */
const brief = (j: Job) => ({
  id: j.id,
  company: j.company,
  title: j.title,
  location: j.location,
  pay: j.pay,
  stage: j.stage,
  ...(j.moonshot ? { moonshot: true, moonshotRank: j.moonshotRank } : {}),
  ...(j.batch ? { batch: j.batch } : {}),
  ...(j.flags?.length ? { flags: j.flags } : {}),
});

const stage = z.enum(STAGES);
const ats = z.enum(['greenhouse', 'ashby', 'lever']);

const jobFields = {
  company: z.string().optional(),
  website: z.string().optional().describe('The company\'s own website domain, e.g. "anduril.com", never the job board. Shows its logo. Set it when you know it.'),
  title: z.string().optional(),
  location: z.string().optional(),
  url: z.string().optional(),
  portal: z.string().optional(),
  pay: z.string().optional().describe('Pay as text, e.g. "$150k–$190k + equity" or "not listed".'),
  payMin: z.number().optional(),
  payMax: z.number().optional(),
  remote: z.boolean().optional(),
  posted: z.string().optional(),
  stage: stage.optional(),
  moonshot: z.boolean().optional(),
  moonshotRank: z.number().int().optional(),
  batch: z.string().optional().describe('Group name for roles to apply to together, e.g. "spring push".'),
  strengths: z.array(z.string()).optional(),
  gaps: z.array(z.string()).optional(),
  flags: z.array(z.string()).optional().describe('Short warnings: "pay not listed", "competitor", "25% travel".'),
  verdict: z.string().optional(),
  notes: z.string().optional(),
  description: z.string().optional().describe('Posting text.'),
  appliedAt: z.string().optional().describe('YYYY-MM-DD the user applied.'),
  outcome: z.enum(['in_progress', 'hired', 'offer_declined', 'rejected', 'no_response', 'interview_only', 'skipped']).optional(),
  steps: z.array(z.string()).optional().describe('Interview steps reached: Phone screen, Technical, Case, Final round, Offer received.'),
};

export interface ToolHost {
  /** Show a page in the app, e.g. "/jobs/<id>" or "/docs/<id>". */
  navigate(path: string): void;
}

/**
 * Models sometimes double-escape long markdown arguments, so "\\n" arrives as
 * a literal backslash-n instead of a line break. A string with no real line
 * breaks but several escaped ones was meant to have line breaks.
 */
function unescapeText(v: unknown): unknown {
  if (typeof v === 'string') {
    return !v.includes('\n') && (v.match(/\\n/g)?.length ?? 0) >= 2 ? v.replace(/(?:\\r)?\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"') : v;
  }
  if (Array.isArray(v)) return v.map(unescapeText);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unescapeText(x)]));
  return v;
}

export function buildTools(host: ToolHost): Record<string, Tool> {
  const tools = makeTools(host);
  for (const t of Object.values(tools)) {
    if (!t.write) continue;
    const execute = t.execute.bind(t);
    t.execute = (raw, opts) => execute(unescapeText(raw), opts);
  }
  return tools;
}

function makeTools(host: ToolHost): Record<string, Tool> {
  return {
    get_profile: defineTool({
      description: "Read the user's profile: contact details, search rules, confirmed facts and writing style.",
      inputSchema: z.object({}),
      run: async () => json(await getProfile()),
    }),

    update_profile: defineTool({
      description:
        "Change the user's profile when the user asks, or when filling it in from their uploaded files. " +
        'Text fields are markdown and replace the old value, so read the profile first and merge rather than drop what is there.',
      inputSchema: z.object({
        name: z.string().optional(),
        headline: z.string().optional(),
        location: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        links: z.array(z.object({ label: z.string(), href: z.string() })).optional(),
        rules: z.string().optional().describe('Search rules: pay floors, locations, seniority, travel, deal-breakers.'),
        facts: z.string().optional().describe('Facts the user confirmed and that may appear in tailored documents.'),
        style: z.string().optional().describe('Writing style and voice.'),
        notes: z.string().optional().describe('Working notes: open questions, decisions, plans and next steps.'),
      }),
      write: true,
      run: async (patch) => {
        const p = await getProfile();
        await db.profile.put({ ...p, ...patch });
        return 'Profile updated.';
      },
    }),

    list_jobs: defineTool({
      description: 'List saved listings, optionally filtered. Returns brief rows; use get_job for one in full.',
      inputSchema: z.object({
        noWebsite: z.boolean().optional().describe('Only listings whose company website (for the logo) is unknown.'),
        stage: stage.optional(),
        moonshot: z.boolean().optional(),
        batch: z.string().optional(),
        query: z.string().optional().describe('Matches company, title or location.'),
      }),
      run: async ({ stage, moonshot, batch, query, noWebsite }) => {
        let jobs = await db.jobs.toArray();
        if (noWebsite) jobs = jobs.filter((j) => !companyDomain(j));
        if (stage) jobs = jobs.filter((j) => j.stage === stage);
        if (moonshot !== undefined) jobs = jobs.filter((j) => !!j.moonshot === moonshot);
        if (batch) jobs = jobs.filter((j) => j.batch?.toLowerCase() === batch.toLowerCase());
        if (query) {
          const q = query.toLowerCase();
          jobs = jobs.filter((j) => `${j.company} ${j.title} ${j.location}`.toLowerCase().includes(q));
        }
        jobs.sort((a, b) => (a.moonshotRank ?? 99) - (b.moonshotRank ?? 99) || b.updatedAt - a.updatedAt);
        return jobs.length ? json(jobs.map(brief)) : 'No listings match.';
      },
    }),

    get_job: defineTool({
      description: 'Read one listing in full, including the posting text, notes and log, plus the documents written for it.',
      inputSchema: z.object({ id: z.string() }),
      run: async ({ id }) => {
        const job = await db.jobs.get(id);
        if (!job) return { content: `No listing with id ${id}.`, isError: true };
        const docs = await db.docs.where('jobId').equals(id).toArray();
        return json({ ...job, documents: docs.map((d) => ({ id: d.id, kind: d.kind, title: d.title })) });
      },
    }),

    save_job: defineTool({
      description:
        'Create or update a listing. For a new one give id (e.g. "greenhouse:stripe:7844214"), company, title, location and url. ' +
        'For an existing one give id plus only the fields to change. Arrays replace the old value.',
      inputSchema: z.object({ id: z.string(), ...jobFields }),
      write: true,
      run: async ({ id, ...patch }) => {
        const prev = await db.jobs.get(id);
        const job = await upsertJob({ id, ...patch });
        if (prev && patch.stage && patch.stage !== prev.stage) await logJob(id, `Moved to ${patch.stage}`);
        if (patch.stage === 'applied' && !job.appliedAt) await db.jobs.update(id, { appliedAt: today(), outcome: job.outcome ?? 'in_progress' });
        return `${prev ? 'Updated' : 'Saved'} ${job.company}: ${job.title} (${job.stage}).`;
      },
    }),

    log_job: defineTool({
      description: 'Add a dated note to a listing\'s history, e.g. "Recruiter call, range is $160k–$180k".',
      inputSchema: z.object({ id: z.string(), text: z.string() }),
      write: true,
      run: async ({ id, text }) => {
        if (!(await db.jobs.get(id))) return { content: `No listing with id ${id}.`, isError: true };
        await logJob(id, text);
        return 'Logged.';
      },
    }),

    set_company_websites: defineTool({
      description:
        "Set companies' own website domains (e.g. \"anduril.com\"), which show their logos. Applies to every listing from that company. " +
        'Only give domains you are sure of; leave out companies you are not.',
      inputSchema: z.object({ sites: z.array(z.object({ company: z.string(), website: z.string() })).min(1) }),
      write: true,
      run: async ({ sites }) => {
        const jobs = await db.jobs.toArray();
        let n = 0;
        for (const { company, website } of sites) {
          const domain = normalizeWebsite(website);
          if (!domain) continue;
          const key = company.trim().toLowerCase();
          const hits = jobs.filter((j) => j.company.trim().toLowerCase() === key);
          await db.jobs.bulkUpdate(hits.map((j) => ({ key: j.id, changes: { website: domain } })));
          n += hits.length;
        }
        return `Set websites on ${n} listings.`;
      },
    }),

    delete_job: defineTool({
      description: 'Delete a listing. Prefer moving it to stage "closed" unless the user asks to delete.',
      inputSchema: z.object({ id: z.string() }),
      write: true,
      run: async ({ id }) => {
        await db.jobs.delete(id);
        return 'Deleted.';
      },
    }),

    search_board: defineTool({
      description:
        "Search a company's public job board on Greenhouse, Ashby or Lever. `board` is the company's slug, e.g. " +
        'greenhouse "stripe" or "airbnb", ashby "openai", lever "palantir". ' +
        'Returns id, title, location and pay where posted. Unknown slugs return "Board not found": try variants.',
      inputSchema: z.object({
        ats,
        board: z.string(),
        title: z.string().optional().describe('Regex matched against titles, case-insensitive, e.g. "engineer|designer".'),
        exclude: z.string().optional().describe('Regex of titles to drop, e.g. "intern|director|technician".'),
        location: z.string().optional().describe('Regex matched against locations, e.g. "Remote|New York".'),
        limit: z.number().int().max(200).optional(),
      }),
      timeoutMs: 60_000,
      run: async ({ ats, board, title, exclude, location, limit }) => {
        const all = await listBoard(ats as Ats, board);
        const t = title ? new RegExp(title, 'i') : null;
        const x = exclude ? new RegExp(exclude, 'i') : null;
        const l = location ? new RegExp(location, 'i') : null;
        const hits = all.filter((j) => (!t || t.test(j.title)) && (!x || !x.test(j.title)) && (!l || l.test(j.location)));
        const rows = hits.slice(0, limit ?? 60).map((j) => `${j.id} | ${j.title} | ${j.location} | ${j.pay ?? 'pay n/a'}`);
        return `${hits.length} of ${all.length} postings match on ${ats}:${board}${hits.length > rows.length ? ` (showing ${rows.length})` : ''}\n${rows.join('\n')}`;
      },
    }),

    read_posting: defineTool({
      description: 'Read one posting in full from Greenhouse, Ashby or Lever. Give a posting URL, or ats + board + id.',
      inputSchema: z.object({ url: z.string().optional(), ats: ats.optional(), board: z.string().optional(), id: z.string().optional() }),
      timeoutMs: 60_000,
      run: async ({ url, ats, board, id }) => {
        const ref = url ? parsePostingUrl(url) : ats && board && id ? { ats, board, id } : null;
        if (!ref) return { content: 'Give a Greenhouse, Ashby or Lever posting URL, or ats + board + id. Other sites cannot be read from the browser.', isError: true };
        const p = await getPosting(ref.ats, ref.board, ref.id);
        return `Key: ${p.ats}:${p.board}:${p.id}\nTitle: ${p.title}\nLocation: ${p.location}\nPay: ${p.pay ?? 'not listed'}\nURL: ${p.url}\nPosted: ${p.posted ?? '?'}\n\n${p.text ?? ''}`;
      },
    }),

    list_documents: defineTool({
      description: 'List resumes, cover letters and application answers.',
      inputSchema: z.object({ kind: z.enum(['resume', 'letter', 'answer']).optional(), jobId: z.string().optional() }),
      run: async ({ kind, jobId }) => {
        let docs = await db.docs.toArray();
        if (kind) docs = docs.filter((d) => d.kind === kind);
        if (jobId) docs = docs.filter((d) => d.jobId === jobId);
        return json(docs.map((d) => ({ id: d.id, kind: d.kind, title: d.title, base: d.base, variant: d.variant, jobId: d.jobId })));
      },
    }),

    get_document: defineTool({
      description: 'Read a document with its full data.',
      inputSchema: z.object({ id: z.string() }),
      run: async ({ id }) => {
        const d = await db.docs.get(id);
        if (!d) return { content: `No document ${id}.`, isError: true };
        const { css, ...rest } = d;
        return json(rest.kind === 'answer' ? rest : { ...rest, design: css ? 'custom (read it with get_design)' : 'default' });
      },
    }),

    get_design: defineTool({
      description:
        "Read a resume's or letter's design: the whole stylesheet that lays out and styles its page, plus the markup it styles. " +
        'Read it before changing the design.',
      inputSchema: z.object({ id: z.string() }),
      run: async ({ id }) => {
        const d = await sheetDoc(id);
        if (typeof d === 'string') return { content: d, isError: true };
        return `Design of ${d.kind} "${d.title}" (${d.css ? 'custom' : 'the default design'}):\n\n${designOf(d.css)}\n\n---\n${MARKUP_GUIDE}`;
      },
    }),

    edit_design: defineTool({
      description:
        "Change a resume's or letter's design by replacing exact text in its stylesheet, like editing a CSS file. " +
        'Each `find` must appear exactly once unless `all` is set; copy it from get_design. Use for targeted changes: fonts, colors, spacing, layout. ' +
        'The result says whether the page still fits.',
      inputSchema: z.object({
        id: z.string(),
        edits: z.array(z.object({ find: z.string(), replace: z.string(), all: z.boolean().optional() })).min(1),
      }),
      write: true,
      run: async ({ id, edits }) => {
        const d = await sheetDoc(id);
        if (typeof d === 'string') return { content: d, isError: true };
        let css = designOf(d.css);
        for (const [i, e] of edits.entries()) {
          const count = e.find ? css.split(e.find).length - 1 : 0;
          if (!count) return { content: `Edit ${i + 1}: \`find\` is not in the stylesheet. Nothing was saved; read it again with get_design.`, isError: true };
          if (count > 1 && !e.all) return { content: `Edit ${i + 1}: \`find\` appears ${count} times. Include more surrounding text, or set all. Nothing was saved.`, isError: true };
          css = e.all ? css.split(e.find).join(e.replace) : css.replace(e.find, () => e.replace);
        }
        return saveDesign(d, css, host);
      },
    }),

    set_design: defineTool({
      description:
        "Replace a resume's or letter's whole stylesheet, for a new design from scratch. Style the markup described by get_design. " +
        'An empty string restores the default design. The result says whether the page fits.',
      inputSchema: z.object({ id: z.string(), css: z.string() }),
      write: true,
      run: async ({ id, css }) => {
        const d = await sheetDoc(id);
        if (typeof d === 'string') return { content: d, isError: true };
        return saveDesign(d, css, host);
      },
    }),

    copy_design: defineTool({
      description: "Give other resumes and letters the same design as one document, e.g. so a cover letter matches its resume.",
      inputSchema: z.object({ from: z.string(), to: z.array(z.string()).min(1) }),
      write: true,
      run: async ({ from, to }) => {
        const src = await sheetDoc(from);
        if (typeof src === 'string') return { content: src, isError: true };
        const lines: string[] = [];
        for (const id of to) {
          const d = await sheetDoc(id);
          if (typeof d === 'string') { lines.push(d); continue; }
          await db.docs.update(id, { css: src.css, updatedAt: now() });
          lines.push(`"${d.title}": ${await measureSheet({ ...d, css: src.css })}`);
        }
        return lines.join('\n');
      },
    }),

    save_resume: defineTool({
      description:
        'Create or replace a resume. To tailor, get_document the base resume, change the text, then save it as a NEW document ' +
        '(omit id) with jobId set. `data` is the full resume in the same shape as the base. ' +
        'Inline links are markdown [text](url). Only use facts already in the base resume or the profile. ' +
        'The result says whether it fits one page; if not, shorten it and save again with the same id.',
      inputSchema: z.object({
        id: z.string().optional(),
        title: z.string(),
        jobId: z.string().optional(),
        variant: z.string().optional(),
        base: z.boolean().optional(),
        data: resumeSchema,
      }),
      write: true,
      run: async ({ id, title, jobId, variant, base, data }) => saveDoc('resume', { id, title, jobId, variant, base, data: data as ResumeData }, host),
    }),

    save_letter: defineTool({
      description:
        'Create or replace a cover letter. Copy `header` from the resume it accompanies. Inline links are markdown [text](url).',
      inputSchema: z.object({
        id: z.string().optional(),
        title: z.string(),
        jobId: z.string().optional(),
        data: letterSchema,
      }),
      write: true,
      run: async ({ id, title, jobId, data }) => saveDoc('letter', { id, title, jobId, data: data as LetterData }, host),
    }),

    save_answer: defineTool({
      description: 'Save a short application answer, e.g. for an "Additional information" box or a "Why us?" question.',
      inputSchema: z.object({ id: z.string().optional(), title: z.string(), jobId: z.string().optional(), prompt: z.string().optional(), text: z.string() }),
      write: true,
      run: async ({ id, title, jobId, prompt, text }) => saveDoc('answer', { id, title, jobId, data: { prompt, text } }, host),
    }),

    delete_document: defineTool({
      description: 'Delete a document. Only when the user asks.',
      inputSchema: z.object({ id: z.string() }),
      write: true,
      run: async ({ id }) => {
        await db.docs.delete(id);
        return 'Deleted.';
      },
    }),

    list_files: defineTool({
      description:
        'List files the user uploaded (for example a zip of their job-search folder). Each has a path, a size, ' +
        'whether it is readable text, and a status saying how it was already used. Files marked "imported" were loaded automatically.',
      inputSchema: z.object({ bundle: z.string().optional() }),
      run: async ({ bundle }) => {
        let files = await db.files.toArray();
        if (bundle) files = files.filter((f) => f.bundle === bundle);
        if (!files.length) return 'No uploaded files.';
        return files
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((f) => `${f.id} | ${Math.ceil(f.size / 1024)} KB | ${f.text === undefined ? 'binary, unreadable' : 'text'}${f.status ? ` | ${f.status}` : ''}`)
          .join('\n');
      },
    }),

    read_file: defineTool({
      description: 'Read an uploaded text file by its id from list_files. Long files come in pages: pass offset (1-based line) and limit.',
      inputSchema: z.object({
        id: z.string(),
        offset: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(1500).optional(),
      }),
      run: async ({ id, offset = 1, limit = 600 }) => {
        const f = await db.files.get(id);
        if (!f) return { content: `No file ${id}. Use list_files for ids.`, isError: true };
        if (f.text === undefined) return { content: `${id} is binary and cannot be read. Look for a .txt or .md version next to it.`, isError: true };
        const lines = f.text.split('\n');
        const page = lines.slice(offset - 1, offset - 1 + limit).join('\n');
        const more = offset - 1 + limit < lines.length ? `\n\n[lines ${offset}-${offset - 1 + limit} of ${lines.length}; read on with offset ${offset + limit}]` : '';
        return page + more;
      },
    }),

    mark_file: defineTool({
      description: 'Record how an uploaded file was used, e.g. "analyzed: profile facts, Acme listing". Shown to the user next to the file.',
      inputSchema: z.object({ id: z.string(), status: z.string() }),
      write: true,
      run: async ({ id, status }) => {
        const n = await db.files.update(id, { status });
        return n ? 'Marked.' : { content: `No file ${id}.`, isError: true };
      },
    }),

    show: defineTool({
      description:
        'Open a page in the app for the user: "/" (today), "/listings", "/moonshots", "/pipeline", "/documents", ' +
        '"/jobs/<id>" or "/documents/<id>". Use it after creating something the user will want to look at.',
      inputSchema: z.object({ path: z.string() }),
      run: async ({ path }) => {
        host.navigate(path);
        return `Showing ${path}.`;
      },
    }),

    ...formTools(),
  };
}

async function saveDoc<T>(kind: Doc['kind'], d: { id?: string; title: string; jobId?: string; variant?: string; base?: boolean; data: T }, host: ToolHost) {
  const prev = d.id ? await db.docs.get(d.id) : undefined;
  if (d.jobId && !(await db.jobs.get(d.jobId))) return { content: `No listing with id ${d.jobId}.`, isError: true };
  const id = prev?.id ?? uid();
  const doc: Doc = {
    ...prev,
    id,
    kind,
    title: d.title,
    jobId: d.jobId ?? prev?.jobId,
    variant: d.variant ?? prev?.variant,
    base: d.base ?? prev?.base,
    data: d.data,
    // New documents take the design of the base resume they were tailored from.
    css: prev ? prev.css : await inheritedDesign(kind, d.variant),
    createdAt: prev?.createdAt ?? now(),
    updatedAt: now(),
  };
  await db.docs.put(doc);
  const fit = kind === 'answer' ? '' : ` ${await measureSheet(doc)}`;
  if (!prev) host.navigate(`/documents/${id}`);
  return `${prev ? 'Updated' : 'Created'} ${kind} "${d.title}" (id ${id}).${fit}`;
}

/** A resume or letter, or why it can't have a design. */
async function sheetDoc(id: string): Promise<Doc | string> {
  const d = await db.docs.get(id);
  if (!d) return `No document ${id}.`;
  if (d.kind === 'answer') return `${id} is a short answer, which is plain text with no design.`;
  return d;
}

async function saveDesign(d: Doc, css: string, host: ToolHost) {
  const custom = css.trim() && css !== designOf(undefined) ? css : undefined;
  await db.docs.update(d.id, { css: custom, updatedAt: now() });
  host.navigate(`/documents/${d.id}`);
  const { blocked } = cleanCss(custom ?? '');
  const note = blocked.length ? ` These URLs were blocked; only data: URLs and Google Fonts load: ${blocked.join(', ')}.` : '';
  return `${custom ? 'Design saved' : 'Restored the default design'} for "${d.title}". ${await measureSheet({ ...d, css: custom })}${note}`;
}
