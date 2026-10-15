import { z } from 'zod';

/**
 * Zod mirrors of ResumeData and LetterData. The agent's save tools validate
 * against these, so a malformed document comes back to the model as a
 * precise error instead of reaching the renderer.
 */

const str = z.string();
const link = z.object({ label: str, href: str.optional() });

const header = z.object({
  eyebrow: z.array(str).describe('Roles above the name, e.g. ["Mechanical Engineer", "Software Developer"].'),
  name: str,
  contact: z.array(link),
  rev: str.describe('YYYY.MM'),
});

const base = {
  title: str.describe('Heading. "" leaves the heading out.'),
  class: str.optional().describe('Extra class on the <section> for the design to target.'),
  column: str
    .optional()
    .describe('For multi-column designs: sections are grouped by column into <div class="sheet-column" data-column="{name}">, e.g. "side" and "main". Sections without one go in "main". Leave out everywhere for one column.'),
};

const section = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), ...base, text: str }),
  z.object({ kind: z.literal('skills'), ...base, rows: z.array(z.object({ label: str, items: z.array(str) })) }),
  z.object({
    kind: z.literal('experience'),
    ...base,
    companies: z.array(
      z.object({
        line: str.describe('Company line, e.g. "[Acme](https://acme.com) • Full-Time • Remote • 5 Years".'),
        roles: z.array(z.object({ title: str, active: z.boolean().optional(), dates: str, bullets: z.array(str) })),
      }),
    ),
  }),
  z.object({
    kind: z.literal('projects'),
    ...base,
    cards: z.array(
      z.object({ title: str, date: str.optional(), links: z.array(link).optional(), award: str.optional(), desc: str, stack: str.optional() }),
    ),
  }),
  z.object({ kind: z.literal('education'), ...base, items: z.array(z.object({ degree: str, school: str, date: str })) }),
  z.object({
    kind: z.literal('html'),
    ...base,
    html: str.describe('Markup for anything the other kinds cannot express. Inert: no scripts, forms or embeds; images must be data: URLs.'),
  }),
]);

export const resumeSchema = z.object({
  header,
  sections: z.array(section),
  footer: z.object({ label: str, items: z.array(str) }).optional(),
  keywords: str.optional().describe('Hidden ATS keywords; only real skills.'),
});

export const letterSchema = z.object({
  header,
  date: str,
  to: z.object({ name: str, company: str, location: str.optional() }),
  re: str,
  reference: str.optional(),
  salutation: str,
  opening: str,
  points: z.array(z.object({ lead: str, text: str })).describe('Two to four callouts.'),
  body: z.array(str).describe('Paragraphs.'),
  closing: str,
  signoff: str,
  enclosure: z.array(str).optional().describe('e.g. ["Resume (1 sheet)"]'),
});
