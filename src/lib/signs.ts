import { useSyncExternalStore } from 'react';
import { liveQuery } from 'dexie';
import { db, getProfile } from './db';
import type { Job } from './types';
import { shortPay } from './utils';

/**
 * Signs: the handful of things about a quest you care about at a glance,
 * each a small glyph in a fixed slot, so a row reads like a stat line and a
 * list can be narrowed by any of them. They come from the listing itself and
 * from what the guide has written about it; nothing is fetched.
 */

export const SIGNS = ['remote', 'pay', 'fit', 'flags', 'moonshot', 'ready', 'fresh'] as const;
export type SignId = (typeof SIGNS)[number];

export type SignTone = 'info' | 'gold' | 'success' | 'warning' | 'danger' | 'violet';

export interface Sign {
  id: SignId;
  /** good is the one worth filtering for; the others still show, in their own color. */
  level: 'good' | 'mixed' | 'poor';
  tone: SignTone;
  /** What it says in a word or two: "Remote", "Strong fit", "2 flags". */
  label: string;
  /** The longer line behind it, for the tooltip. */
  detail?: string;
}

/** What each sign is called when you filter by it, and what an empty slot means. */
export const SIGN_NAME: Record<SignId, string> = {
  remote: 'Remote',
  pay: 'Pay listed',
  fit: 'Strong fit',
  flags: 'Flagged',
  moonshot: 'Long shot',
  ready: 'Resume ready',
  fresh: 'New this week',
};

export const SIGN_NONE: Record<SignId, string> = {
  remote: 'On site, or not said',
  pay: 'Pay not listed',
  fit: 'The guide hasn’t read it yet',
  flags: 'No flags',
  moonshot: 'Not a long shot',
  ready: 'No resume for it yet',
  fresh: 'Not a new posting',
};

/** What the signs need beyond the listing: which quests have a resume, and the pay floor from the profile. */
export interface SignContext {
  ready: ReadonlySet<string>;
  floor?: number;
}

const DAY = 86_400_000;

const payListed = (job: Job) => !!(job.payMax ?? job.payMin) || (!!job.pay && !/^not listed/i.test(job.pay));

/** The name of the pay filter depends on whether a floor is set. */
export const payFilterName = (ctx: SignContext) => (ctx.floor ? 'Meets your floor' : SIGN_NAME.pay);

export function signsOf(job: Job, ctx: SignContext): Partial<Record<SignId, Sign>> {
  const out: Partial<Record<SignId, Sign>> = {};

  const hybrid = /\bhybrid\b/i.test(job.location);
  if (job.remote || hybrid || /\b(remote|anywhere|work from home|wfh)\b/i.test(job.location)) {
    out.remote = { id: 'remote', level: hybrid && !job.remote ? 'mixed' : 'good', tone: 'info', label: hybrid && !job.remote ? 'Hybrid' : 'Remote', detail: job.location || undefined };
  }

  if (payListed(job)) {
    const top = job.payMax ?? job.payMin;
    const text = job.pay ? shortPay(job.pay) : top ? `$${Math.round(top / 1000)}k` : '';
    if (ctx.floor && top) {
      const ok = top >= ctx.floor;
      out.pay = { id: 'pay', level: ok ? 'good' : 'poor', tone: ok ? 'gold' : 'warning', label: ok ? 'Meets your floor' : 'Below your floor', detail: text };
    } else {
      out.pay = { id: 'pay', level: 'good', tone: 'gold', label: 'Pay listed', detail: text };
    }
  }

  const s = job.strengths?.length ?? 0;
  const g = job.gaps?.length ?? 0;
  if (s || g || job.verdict) {
    const level = s > g ? 'good' : s === g ? 'mixed' : 'poor';
    const parts = [s ? `${s} strength${s === 1 ? '' : 's'}` : '', g ? `${g} gap${g === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ');
    // A poor fit is "a stretch", not a verdict against the user: the guide's read, said kindly.
    out.fit = {
      id: 'fit',
      level,
      tone: level === 'good' ? 'success' : level === 'mixed' ? 'gold' : 'warning',
      label: level === 'good' ? 'Strong fit' : level === 'mixed' ? 'Fair fit' : 'A stretch',
      detail: parts || job.verdict,
    };
  }

  if (job.flags?.length) {
    const n = job.flags.length;
    out.flags = { id: 'flags', level: 'poor', tone: 'warning', label: n === 1 ? job.flags[0] : `${n} flags`, detail: n === 1 ? undefined : job.flags.join('; ') };
  }

  if (job.moonshot) {
    out.moonshot = { id: 'moonshot', level: 'good', tone: 'violet', label: job.moonshotRank ? `Long shot #${job.moonshotRank}` : 'Long shot' };
  }

  if (ctx.ready.has(job.id)) {
    out.ready = { id: 'ready', level: 'good', tone: 'success', label: 'Resume ready' };
  }

  if (job.posted) {
    const days = Math.floor((Date.now() - Date.parse(job.posted)) / DAY);
    if (days >= 0 && days <= 7) {
      out.fresh = { id: 'fresh', level: 'good', tone: 'success', label: 'New', detail: days === 0 ? 'Posted today' : days === 1 ? 'Posted yesterday' : `Posted ${days} days ago` };
    }
  }

  return out;
}

/** Whether a quest passes a sign filter: present, and for fit and pay, good. */
export function hasSign(job: Job, id: SignId, ctx: SignContext): boolean {
  const s = signsOf(job, ctx)[id];
  if (!s) return false;
  return id === 'fit' || id === 'pay' ? s.level === 'good' : true;
}

export const matchesSigns = (job: Job, ids: Iterable<SignId>, ctx: SignContext) => [...ids].every((id) => hasSign(job, id, ctx));

// --- Context store ----------------------------------------------------------------

let snapshot: SignContext = { ready: new Set() };
const listeners = new Set<() => void>();
let started = false;

/** One live query for every row, started the first time a sign is drawn. */
function start() {
  if (started) return;
  started = true;
  liveQuery(async () => {
    const [docs, profile] = await Promise.all([db.docs.where('kind').equals('resume').toArray(), getProfile()]);
    return { ready: new Set(docs.map((d) => d.jobId).filter((x): x is string => !!x)), floor: profile.payFloor || undefined } satisfies SignContext;
  }).subscribe({
    next: (v) => {
      snapshot = v;
      listeners.forEach((l) => l());
    },
  });
}

export function useSignContext(): SignContext {
  return useSyncExternalStore(
    (l) => {
      start();
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
  );
}
