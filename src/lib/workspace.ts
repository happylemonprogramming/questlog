import { useSyncExternalStore } from 'react';
import { parsePostingUrl } from './boards';
import type { Job } from './types';

/**
 * Which pane is in front, and which application is open. Phones show one pane
 * at a time; desktops keep the assistant beside either the page or the
 * application. All panes stay mounted, so switching never drops a chat draft
 * or a half-filled form.
 */
export type Pane = 'page' | 'chat' | 'apply';

interface Workspace {
  pane: Pane;
  /** The last pane that wasn't the assistant: what "this" means in a chat. */
  behind: Exclude<Pane, 'chat'>;
  applyJobId: string | null;
}

const APPLY_KEY = 'offerdex:apply';

let state: Workspace = { pane: 'page', behind: 'page', applyJobId: localStorage.getItem(APPLY_KEY) };
const listeners = new Set<() => void>();

function set(patch: Partial<Workspace>) {
  state = { ...state, ...patch };
  if (state.pane !== 'chat') state.behind = state.pane;
  if ('applyJobId' in patch) {
    if (state.applyJobId) localStorage.setItem(APPLY_KEY, state.applyJobId);
    else localStorage.removeItem(APPLY_KEY);
  }
  listeners.forEach((l) => l());
}

export function useWorkspace(): Workspace {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  );
}

export function setPane(pane: Pane) {
  if (pane !== state.pane) set({ pane });
}

export function openApplication(jobId: string) {
  set({ applyJobId: jobId, pane: 'apply' });
}

export function closeApplication() {
  set({ applyJobId: null, pane: 'page' });
}

/**
 * Whether a site lets other pages frame it. Greenhouse sends no framing
 * headers, and Ashby and Workable send `frame-ancestors *`. Workday, LinkedIn,
 * iCIMS, Indeed and SmartRecruiters refuse.
 */
const FRAMEABLE = /(^|\.)(greenhouse\.io|ashbyhq\.com|lever\.co|bamboohr\.com|workable\.com)$/;
const BLOCKED = /(^|\.)(myworkdayjobs\.com|linkedin\.com|icims\.com|indeed\.com|smartrecruiters\.com|taleo\.net|successfactors\.com)$/;

export interface ApplicationPage {
  url: string;
  embed: 'yes' | 'maybe' | 'no';
}

/** The page with the application form for a listing, and whether it can load in a frame. */
export function applicationPage(job: Pick<Job, 'url'>): ApplicationPage | null {
  if (!job.url) return null;
  let url: URL;
  try {
    url = new URL(job.url);
  } catch {
    return null;
  }
  for (const k of [...url.searchParams.keys()]) if (k.startsWith('utm_')) url.searchParams.delete(k);
  const p = parsePostingUrl(url.href);
  const href =
    p?.ats === 'ashby' ? `https://jobs.ashbyhq.com/${p.board}/${p.id}/application`
    : p?.ats === 'lever' ? `https://jobs.lever.co/${p.board}/${p.id}/apply`
    : url.href;
  const host = new URL(href).hostname;
  return { url: href, embed: FRAMEABLE.test(host) ? 'yes' : BLOCKED.test(host) ? 'no' : 'maybe' };
}
