import { defineTool, type Tool } from '@porygon/core';
import { z } from 'zod';
import { db, getProfile } from '@/lib/db';
import { desktop, type FormField } from '@/lib/desktop';
import { applicationPage, openApplication } from '@/lib/workspace';

/**
 * Tools for filling in an application form, in the desktop app only. The form
 * is the employer's own page in the Apply pane; the agent reads its fields,
 * fills them, attaches documents as PDFs and moves between steps. It never
 * submits: the user reviews and presses Submit.
 */

const show = (v: unknown) => (Array.isArray(v) ? v.join(', ') : typeof v === 'string' ? v : JSON.stringify(v));

function describeField(f: FormField) {
  const bits = [`${f.ref} [${f.kind}${f.type && f.type !== 'text' ? `:${f.type}` : ''}${f.required ? ', required' : ''}] ${f.label || '(no label)'}`];
  if (f.options?.length) bits.push(`options: ${f.options.slice(0, 40).join(' | ')}${f.options.length > 40 ? ` | …${f.options.length - 40} more` : ''}`);
  if (f.accept) bits.push(`accepts ${f.accept}`);
  const v = f.value;
  if (v !== undefined && v !== '' && !(Array.isArray(v) && !v.length) && v !== false) bits.push(`now: ${show(v).slice(0, 120)}`);
  return bits.join(' · ');
}

const fileName = async (docId: string) => {
  const [doc, profile] = await Promise.all([db.docs.get(docId), getProfile()]);
  if (!doc) return undefined;
  const job = doc.jobId ? await db.jobs.get(doc.jobId) : undefined;
  const name = profile.name || (doc.data as { header?: { name?: string } }).header?.name || '';
  const parts = [name, doc.kind === 'letter' ? 'Cover Letter' : 'Resume', job?.company.replace(/\s*\(.*\)/, '')].filter(Boolean);
  return parts.join(' ').replace(/\s+/g, '_');
};

export function formTools(): Record<string, Tool> {
  const d = desktop();
  if (!d) return {};
  return {
    open_application: defineTool({
      description: "Open a listing's application form in the Apply pane, next to the user, so you can read and fill it.",
      inputSchema: z.object({ jobId: z.string() }),
      run: async ({ jobId }) => {
        const job = await db.jobs.get(jobId);
        if (!job) return { content: `No listing ${jobId}.`, isError: true };
        const page = applicationPage(job);
        if (!page) return { content: 'This listing has no posting link. Find it and save it with save_job first.', isError: true };
        openApplication(jobId);
        return `Opened ${page.url}. Read it with read_form.`;
      },
    }),

    read_form: defineTool({
      description:
        'List the fields and buttons of the application form open in the Apply pane: a ref for each, its label, kind, options and current value. ' +
        'Read it before filling, and again after clicking to a new step.',
      inputSchema: z.object({}),
      timeoutMs: 40_000,
      run: async () => {
        const f = await d.form.read();
        const lines = [`${f.title} — ${f.url}`, '', `Fields (${f.fields.length}):`, ...f.fields.map(describeField)];
        if (f.buttons.length) lines.push('', 'Buttons:', ...f.buttons.map((b) => `${b.ref} "${b.text}"${b.submits ? ' (submits: only the user may press it)' : ''}`));
        if (!f.fields.length) lines.push('No fields found. The form may be behind an "Apply" button: click it, or read_page to see what is there.');
        return lines.join('\n');
      },
    }),

    fill_form: defineTool({
      description:
        'Fill fields on the open application form by ref. Text fields take text; selects, radios and comboboxes take the option text; ' +
        'checkboxes take true/false, or for a group a list of option texts. Use only facts from the profile, resume and documents; ' +
        'leave questions you cannot answer truthfully for the user and say which.',
      inputSchema: z.object({ fields: z.array(z.object({ ref: z.string(), value: z.union([z.string(), z.boolean(), z.array(z.string())]) })).min(1) }),
      write: true,
      timeoutMs: 120_000,
      run: async ({ fields }) => {
        const res = await d.form.fill(fields);
        const bad = res.filter((r) => !r.ok);
        return [`Filled ${res.length - bad.length} of ${res.length}.`, ...res.map((r) => `${r.ref}: ${r.ok ? 'ok' : 'failed'}${r.chose ? ` (chose "${r.chose}")` : ''}${r.note ? ` (${r.note})` : ''}`)].join('\n');
      },
    }),

    attach_document: defineTool({
      description:
        "Attach a resume or cover letter to a file field on the open form, as a PDF made from the document exactly as it looks in Questlog. " +
        'Use the resume made for this listing; if there is none, make one first.',
      inputSchema: z.object({ ref: z.string(), documentId: z.string() }),
      write: true,
      timeoutMs: 60_000,
      run: async ({ ref, documentId }) => {
        const doc = await db.docs.get(documentId);
        if (!doc) return { content: `No document ${documentId}.`, isError: true };
        if (doc.kind === 'answer') return { content: 'Short answers are text; put them in a text field with fill_form.', isError: true };
        const r = await d.form.attach(ref, documentId, await fileName(documentId));
        return r.ok ? `Attached ${r.file}.` : { content: `Couldn't attach: ${r.note}`, isError: true };
      },
    }),

    click_form: defineTool({
      description:
        'Click a button or link on the open form by ref, e.g. "Apply for this job", "Next", "Add another". ' +
        'Submit buttons are refused: the user reviews and submits.',
      inputSchema: z.object({ ref: z.string() }),
      write: true,
      timeoutMs: 30_000,
      run: async ({ ref }) => {
        const r = await d.form.click(ref);
        return r.ok ? 'Clicked. Read the form again to see what changed.' : { content: r.note ?? 'That click failed.', isError: !r.refused };
      },
    }),

    read_page: defineTool({
      description: 'Read the visible text of the page in the Apply pane, e.g. to see instructions, errors after filling, or what a step asks.',
      inputSchema: z.object({}),
      timeoutMs: 30_000,
      run: async () => {
        const p = await d.form.text();
        return `${p.title} — ${p.url}\n\n${p.text}`;
      },
    }),
  };
}

export const FORM_TOOL_NAMES = ['open_application', 'read_form', 'fill_form', 'attach_document', 'click_form', 'read_page'];
