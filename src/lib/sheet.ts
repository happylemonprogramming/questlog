/**
 * Resume and cover-letter content as plain data, so it can live in IndexedDB
 * and an agent can tailor it. Inline links use markdown syntax: `[text](url)`.
 */

export interface Link {
  label: string;
  href?: string;
}

export interface Role {
  title: string;
  active?: boolean;
  dates: string;
  bullets: string[];
}

export interface Company {
  /** Company line, e.g. "[Acme](https://acme.com) • Full-Time • Remote • 5 Years". */
  line: string;
  roles: Role[];
}

export interface ProjectCard {
  title: string;
  date?: string;
  links?: Link[];
  award?: string;
  desc: string;
  stack?: string;
}

/**
 * An empty title leaves the heading out. `class` gives the design a hook, and
 * `column` groups sections into side-by-side columns for multi-column layouts.
 */
interface SectionBase {
  title: string;
  class?: string;
  column?: string;
}

export type Section = SectionBase &
  (
    | { kind: 'text'; text: string }
    | { kind: 'skills'; rows: { label: string; items: string[] }[] }
    | { kind: 'experience'; companies: Company[] }
    | { kind: 'projects'; cards: ProjectCard[] }
    | { kind: 'education'; items: { degree: string; school: string; date: string }[] }
    /** Free-form markup for anything the other kinds can't express. */
    | { kind: 'html'; html: string }
  );

export interface SheetHeader {
  /** Shown above the name, e.g. ["Mechanical Engineer", "Software Developer"]. */
  eyebrow: string[];
  name: string;
  contact: Link[];
  rev: string;
}

export interface ResumeData {
  header: SheetHeader;
  sections: Section[];
  footer?: { label: string; items: string[] };
  /** Hidden keywords for applicant tracking systems. Only list real skills. */
  keywords?: string;
}

export interface LetterData {
  header: SheetHeader;
  date: string;
  to: { name: string; company: string; location?: string };
  re: string;
  reference?: string;
  salutation: string;
  opening: string;
  /** Two to four callouts mapping the role's needs to proof from the resume. */
  points: { lead: string; text: string }[];
  body: string[];
  closing: string;
  signoff: string;
  enclosure?: string[];
}

export const SAMPLE_RESUME: ResumeData = {
  header: {
    eyebrow: ['Mechanical Engineer', 'Product Developer'],
    name: 'Your Name',
    contact: [
      { label: 'City, ST' },
      { label: '555.555.5555' },
      { label: 'you@example.com', href: 'mailto:you@example.com' },
      { label: 'LinkedIn', href: 'https://www.linkedin.com/' },
    ],
    rev: new Date().toISOString().slice(0, 7).replace('-', '.'),
  },
  sections: [
    {
      kind: 'text',
      title: 'Summary',
      text: 'One or two sentences on what you build and what you want to build next.',
    },
    {
      kind: 'skills',
      title: 'Skills',
      rows: [
        { label: 'Design', items: ['SolidWorks', 'GD&T', 'DFM', 'FMEA'] },
        { label: 'Software', items: ['Python', 'TypeScript'] },
      ],
    },
    {
      kind: 'experience',
      title: 'Experience',
      companies: [
        {
          line: '[Company](https://example.com) • Full-Time • City • 4 Years',
          roles: [
            {
              title: 'Senior Engineer',
              active: true,
              dates: 'Jan. 2023 – Present',
              bullets: ['Lead a measurable result, with the number that proves it', 'Another result, with scope and impact'],
            },
          ],
        },
      ],
    },
    {
      kind: 'education',
      title: 'Education',
      items: [{ degree: 'Bachelor of Science, Mechanical Engineering', school: 'University', date: 'Graduated 2015' }],
    },
  ],
  footer: { label: 'OFF THE CLOCK', items: ['Something memorable about you'] },
};

export function sampleLetter(header: SheetHeader): LetterData {
  return {
    header,
    date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    to: { name: 'Hiring Manager', company: 'Company' },
    re: 'Role title',
    salutation: 'Dear Hiring Manager,',
    opening: 'Why this role, and the single strongest reason you fit it.',
    points: [
      { lead: 'First need', text: 'Proof from your resume.' },
      { lead: 'Second need', text: 'Proof from your resume.' },
    ],
    body: [],
    closing: 'Thank you for your time. I would welcome a conversation, and my resume is enclosed.',
    signoff: 'Sincerely,',
    enclosure: ['Resume (1 sheet)'],
  };
}
