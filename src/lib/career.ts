import { db, getProfile, SAMPLE_ID } from './db';
import type { Doc } from './types';
import type { Company, ProjectCard, ResumeData } from './sheet';

/**
 * The career record is everything the user has done, in full, with no page
 * limit. Each resume is written from it for one listing, so no earlier resume
 * shapes the next one.
 */

const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];
const key = (s: string) => s.toLowerCase().replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\W+/g, ' ').trim();
const stripTags = (html: string) => html.replace(/<(br|\/p|\/li|\/div|\/h\d)[^>]*>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();

/**
 * One record from several resumes (say a mechanical and a software version):
 * every role, bullet, project and skill they hold, each once.
 */
export function careerFromResumes(resumes: ResumeData[]): string {
  const headlines: string[] = [];
  const contact = new Map<string, string>();
  const summaries: string[] = [];
  const skills = new Map<string, string[]>();
  const companies = new Map<string, { line: string; roles: Map<string, { title: string; dates: string; bullets: string[] }> }>();
  const projects = new Map<string, ProjectCard>();
  const education = new Map<string, string>();
  const other: string[] = [];
  const notes = new Map<string, string[]>();

  const addCompany = (c: Company) => {
    const k = key(c.line.split('•')[0]);
    const entry = companies.get(k) ?? { line: c.line, roles: new Map() };
    if (c.line.length > entry.line.length) entry.line = c.line;
    for (const r of c.roles) {
      const rk = key(`${r.title} ${r.dates}`);
      const role = entry.roles.get(rk) ?? { title: r.title, dates: r.dates, bullets: [] };
      role.bullets = uniq([...role.bullets, ...r.bullets]);
      entry.roles.set(rk, role);
    }
    companies.set(k, entry);
  };

  for (const r of resumes) {
    headlines.push(r.header.eyebrow.join(' / '));
    for (const c of r.header.contact) if (!contact.has(key(c.label))) contact.set(key(c.label), c.href ? `[${c.label}](${c.href})` : c.label);
    for (const s of r.sections) {
      if (s.kind === 'text') summaries.push(s.text);
      else if (s.kind === 'skills') for (const row of s.rows) skills.set(row.label, uniq([...(skills.get(row.label) ?? []), ...row.items]));
      else if (s.kind === 'experience') s.companies.forEach(addCompany);
      else if (s.kind === 'projects') {
        for (const c of s.cards) {
          const prev = projects.get(key(c.title));
          projects.set(key(c.title), !prev ? c : { ...prev, ...c, desc: c.desc.length > prev.desc.length ? c.desc : prev.desc, links: [...(prev.links ?? []), ...(c.links ?? []).filter((l) => !prev.links?.some((p) => p.href === l.href))] });
        }
      } else if (s.kind === 'education') for (const e of s.items) education.set(key(e.degree + e.school), `${e.degree}, ${e.school}, ${e.date}`);
      else if (s.kind === 'html') other.push(`${s.title ? `${s.title}: ` : ''}${stripTags(s.html)}`);
    }
    if (r.footer) notes.set(r.footer.label, uniq([...(notes.get(r.footer.label) ?? []), ...r.footer.items]));
  }

  const out: string[] = [];
  const h = (t: string) => out.push('', `## ${t}`);
  if (uniq(headlines).length) { h('Headlines used'); uniq(headlines).forEach((x) => out.push(`- ${x}`)); }
  if (contact.size) { h('Contact and links'); contact.forEach((v) => out.push(`- ${v}`)); }
  if (uniq(summaries).length) { h('Summaries used'); uniq(summaries).forEach((x) => out.push(`- ${x}`)); }
  if (companies.size) {
    h('Experience');
    for (const c of companies.values()) {
      out.push('', `### ${c.line}`);
      for (const r of c.roles.values()) {
        out.push('', `**${r.title}** (${r.dates})`);
        r.bullets.forEach((b) => out.push(`- ${b}`));
      }
    }
  }
  if (projects.size) {
    h('Projects');
    for (const p of projects.values()) {
      const links = p.links?.filter((l) => l.href).map((l) => `[${l.label}](${l.href})`).join(', ');
      out.push(`- **${p.title}**${p.date ? ` (${p.date})` : ''}: ${p.desc.trim().replace(/([^.!?])$/, '$1.')}${p.award ? ` Award: ${p.award}.` : ''}${p.stack ? ` Stack: ${p.stack}.` : ''}${links ? ` Links: ${links}.` : ''}`);
    }
  }
  if (skills.size) { h('Skills'); skills.forEach((items, label) => out.push(`- ${label}: ${items.join(', ')}`)); }
  if (education.size) { h('Education'); education.forEach((e) => out.push(`- ${e}`)); }
  if (other.length) { h('Other'); uniq(other).forEach((x) => out.push(`- ${x}`)); }
  notes.forEach((items, label) => { h(label); items.forEach((x) => out.push(`- ${x}`)); });
  return out.join('\n').trim();
}

/**
 * Questlog used to keep "base" resumes that tailored copies started from. The
 * first time it runs without a career record, it builds one from them. The
 * old documents stay, as ordinary documents.
 */
export async function adoptBaseResumes() {
  // Older versions put a sample "Base resume" in every new install; drop it if it was never edited.
  if ((await db.docs.get(SAMPLE_ID))?.updatedAt === 0) await db.docs.delete(SAMPLE_ID);
  const p = await getProfile();
  if (p.history !== undefined) return;
  const bases = (await db.docs.where('kind').equals('resume').toArray()).filter((d: Doc) => d.base && d.updatedAt > 0);
  if (!bases.length) return;
  await db.profile.put({ ...p, history: careerFromResumes(bases.map((d) => d.data as ResumeData)) });
}
