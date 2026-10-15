import { useSyncExternalStore } from 'react';
import type { Job } from './types';

/**
 * Company logos come from the company's own website, not the job board, so a
 * LinkedIn or Greenhouse listing still gets the right one. The website is the
 * listing's `website`, or the posting's host when that is the company's site.
 */

/** Hosts that belong to job boards and applicant tracking systems, never to the employer. */
const BOARDS =
  /(^|\.)(greenhouse\.io|ashbyhq\.com|lever\.co|linkedin\.com|indeed\.com|myworkdayjobs\.com|myworkdaysite\.com|workday\.com|icims\.com|smartrecruiters\.com|bamboohr\.com|workable\.com|jobvite\.com|taleo\.net|successfactors\.(com|eu)|oraclecloud\.com|ultipro\.com|ukg\.com|paylocity\.com|paycomonline\.net|adp\.com|recruitee\.com|breezy\.hr|jazzhr\.com|applytojob\.com|rippling\.com|dover\.com|wellfound\.com|angel\.co|builtin\.com|glassdoor\.com|ziprecruiter\.com|dice\.com|monster\.com|simplyhired\.com|google\.com|ycombinator\.com|workatastartup\.com|otta\.com|welcometothejungle\.com|hiringcafe\.com|usajobs\.gov|clearancejobs\.com|teamtailor\.com|personio\.(de|com)|pinpointhq\.com|gem\.com|eightfold\.ai|phenompeople\.com|avature\.net|brassring\.com|careers-page\.com)$/i;

/** The registrable part of a host: careers.acme.com → acme.com, jobs.acme.co.uk → acme.co.uk. */
function registrable(host: string) {
  const parts = host.toLowerCase().replace(/^www\./, '').split('.');
  const n = parts.length >= 3 && parts.at(-1)!.length === 2 && /^(co|com|org|net|ac|gov|edu)$/.test(parts.at(-2)!) ? 3 : 2;
  return parts.slice(-n).join('.');
}

export function normalizeWebsite(v: string | undefined): string | undefined {
  const s = v?.trim();
  if (!s) return undefined;
  try {
    return registrable(new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).hostname);
  } catch {
    return undefined;
  }
}

export function companyDomain(job: Pick<Job, 'website' | 'url' | 'portal'>): string | undefined {
  if (job.website) return normalizeWebsite(job.website);
  for (const u of [job.url, job.portal]) {
    if (!u) continue;
    try {
      const host = new URL(u).hostname;
      if (!BOARDS.test(host)) return registrable(host);
    } catch {
      // Not a URL; try the next one.
    }
  }
  return undefined;
}

export const logoUrl = (domain: string) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;

/** Logos that turned out to be missing or too small, so they aren't requested again this session. */
export const missingLogos = new Set<string>();

const KEY = 'offerdex:logos';
const listeners = new Set<() => void>();

/** Logos are on unless turned off in Settings; each one is a request to Google's favicon service. */
export function useLogos(): boolean {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => localStorage.getItem(KEY) !== '0',
  );
}

export function setLogos(on: boolean) {
  localStorage.setItem(KEY, on ? '1' : '0');
  listeners.forEach((l) => l());
}
