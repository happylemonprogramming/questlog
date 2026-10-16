import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from './db';
import type { Doc, Job } from './types';

/**
 * The game in the quest log. Points reward effort, the part of a job search
 * you control: tracking a role, writing for it, sending it, following up,
 * showing up to interviews. Nothing is ever taken away, and a rejection earns
 * points too, because sending it was the work. Everything is worked out from
 * the listings and documents themselves, so there's no score to drift out of
 * step or to keep.
 */

export interface Deed {
  at: string;
  /** What was done, e.g. "Turned in Acme: Senior Engineer". */
  text: string;
  xp: number;
  jobId?: string;
}

export const XP = {
  tracked: 5,
  note: 5,
  answer: 10,
  letter: 15,
  resume: 20,
  turnedIn: 50,
  closedAfter: 15,
  interviewStep: 40,
  offer: 200,
} as const;

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const name = (j: Job) => `${j.company}: ${j.title}`;

export function deeds(jobs: Job[], docs: Doc[]): Deed[] {
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const out: Deed[] = [];
  for (const j of jobs) {
    if (j.stage !== 'inbox') out.push({ at: day(j.createdAt), text: `Took on ${name(j)}`, xp: XP.tracked, jobId: j.id });
    if (j.appliedAt) out.push({ at: j.appliedAt, text: `Turned in ${name(j)}`, xp: XP.turnedIn, jobId: j.id });
    for (const step of j.steps ?? []) {
      if (step === 'Offer received') continue;
      out.push({ at: day(j.updatedAt), text: `${step} with ${j.company}`, xp: XP.interviewStep, jobId: j.id });
    }
    if (j.stage === 'offer' || j.outcome === 'hired' || j.outcome === 'offer_declined' || j.steps?.includes('Offer received')) {
      out.push({ at: day(j.updatedAt), text: `Offer from ${j.company}`, xp: XP.offer, jobId: j.id });
    }
    if (j.appliedAt && j.stage === 'closed') out.push({ at: day(j.updatedAt), text: `Closed ${name(j)}. The effort still counts`, xp: XP.closedAfter, jobId: j.id });
    // Notes you added yourself (follow-ups, calls), not the app's own "Moved to" lines.
    const notes = (j.log ?? []).filter((l) => !/^(Moved to|Set aside)/.test(l.text)).slice(0, 10);
    for (const l of notes) out.push({ at: l.at, text: `${j.company}: ${l.text}`, xp: XP.note, jobId: j.id });
  }
  for (const d of docs) {
    if (!d.jobId || !byId.has(d.jobId)) continue;
    const j = byId.get(d.jobId)!;
    const xp = d.kind === 'resume' ? XP.resume : d.kind === 'letter' ? XP.letter : XP.answer;
    const what = d.kind === 'resume' ? 'a resume' : d.kind === 'letter' ? 'a cover letter' : 'an answer';
    out.push({ at: day(d.createdAt), text: `Wrote ${what} for ${j.company}`, xp, jobId: j.id });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/** Chapter titles, one per level. None of them are about winning. */
const TITLES = ['Wanderer', 'Seeker', 'Pathfinder', 'Trailblazer', 'Wayfinder', 'Cartographer', 'Seasoned traveler', 'Lorekeeper', 'Guide', 'Legend'];

/** Points needed to reach a level: 0, 100, 300, 600, 1000… Each chapter is a little longer than the last. */
const need = (level: number) => (50 * (level - 1) * level);

export interface Level {
  level: number;
  title: string;
  xp: number;
  /** Points into this chapter, and how many it takes. */
  into: number;
  span: number;
}

export function levelOf(xp: number): Level {
  let level = 1;
  while (xp >= need(level + 1)) level++;
  return { level, title: TITLES[Math.min(level, TITLES.length) - 1], xp, into: xp - need(level), span: need(level + 1) - need(level) };
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Monday of the week a date falls in, as YYYY-MM-DD. */
export function weekOf(date: string | Date) {
  const d = typeof date === 'string' ? new Date(`${date}T12:00:00`) : new Date(date);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return ymd(d);
}

/**
 * Weeks in a row with any effort at all. A single quiet week is a rest and
 * doesn't break the run; only two in a row end it. The week in progress never
 * counts against you.
 */
export function run(all: Deed[]): { weeks: number; restedLast: boolean } {
  const active = new Set(all.map((d) => weekOf(d.at)));
  const cur = new Date(`${weekOf(new Date())}T12:00:00`);
  let weeks = 0;
  let gap = 0;
  let restedLast = false;
  for (let i = 0; i < 520; i++) {
    const w = new Date(cur);
    w.setDate(w.getDate() - 7 * i);
    if (active.has(ymd(w))) {
      weeks++;
      gap = 0;
    } else if (i > 0) {
      if (++gap >= 2) break;
      if (i === 1) restedLast = true;
    }
  }
  // Last week only counts as a rest if the run carried on before it.
  return { weeks, restedLast: restedLast && weeks > (active.has(weekOf(new Date())) ? 1 : 0) };
}

export interface Badge {
  id: string;
  title: string;
  /** How it was earned, or how to earn it. */
  text: string;
  earned: boolean;
}

export function badges(jobs: Job[], docs: Doc[], all: Deed[]): Badge[] {
  const sent = jobs.filter((j) => j.appliedAt).length;
  const resumes = docs.filter((d) => d.kind === 'resume' && d.jobId).length;
  const companies = new Set(jobs.filter((j) => j.stage !== 'inbox').map((j) => j.company.trim().toLowerCase())).size;
  const b = (id: string, title: string, text: string, earned: boolean): Badge => ({ id, title, text, earned });
  return [
    b('first-step', 'First step', 'Took on your first quest', all.some((d) => d.text.startsWith('Took on'))),
    b('turned-in', 'Turned in', 'Sent your first application', sent >= 1),
    b('ten', 'Ten out the door', 'Sent ten applications', sent >= 10),
    b('fifty', 'Fifty', 'Sent fifty applications', sent >= 50),
    b('tailor', 'Tailor', 'Wrote five resumes for their roles', resumes >= 5),
    b('explorer', 'Explorer', 'Tracked roles at 25 companies', companies >= 25),
    b('long-shot', 'Long shot', 'Went for a moonshot anyway', jobs.some((j) => j.moonshot && j.appliedAt)),
    b('thick-skin', 'Thick skin', 'Heard no, or nothing, and kept going', jobs.some((j) => j.appliedAt && j.stage === 'closed') && sent >= 2),
    b('steady', 'Steady', 'Four weeks on the road', run(all).weeks >= 4),
    b('first-talk', 'First conversation', 'Reached an interview', jobs.some((j) => j.steps?.length || j.stage === 'interviewing')),
    b('offer', 'Offer in hand', 'Got an offer', all.some((d) => d.text.startsWith('Offer from'))),
  ];
}

const WEEKLY_KEY = 'questlog:weekly-goal';
const DAILY_KEY = 'questlog:daily-goal';

/**
 * A number kept on this device that every screen sees change at once: the
 * HUD's hearts and the camp's goal are the same goal.
 */
function useStoredNumber(key: string, fallback: number, min: number, max: number) {
  const [value, setValue] = useState(() => Number(localStorage.getItem(key)) || fallback);
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent<string>).detail === key) setValue(Number(localStorage.getItem(key)) || fallback);
    };
    window.addEventListener('questlog:stored', on);
    return () => window.removeEventListener('questlog:stored', on);
  }, [key, fallback]);
  const change = (g: number) => {
    const next = Math.max(min, Math.min(max, g));
    localStorage.setItem(key, String(next));
    window.dispatchEvent(new CustomEvent('questlog:stored', { detail: key }));
  };
  return [value, change] as const;
}

/** How many applications to aim for each week. Remembered on this device. */
export function useWeeklyGoal() {
  return useStoredNumber(WEEKLY_KEY, 5, 1, 25);
}

/** How many applications to aim for today, as hearts. Tap to cycle 1–5. */
export function useDailyGoal() {
  const [goal, set] = useStoredNumber(DAILY_KEY, 3, 1, 5);
  const cycle = () => set((goal % 5) + 1);
  return [goal, cycle] as const;
}

/** Roman numerals for chapters, the way a book numbers them. */
export function roman(n: number) {
  const parts: [number, string][] = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of parts) while (n >= v) { out += s; n -= v; }
  return out || 'I';
}

export interface Journey {
  deeds: Deed[];
  level: Level;
  run: { weeks: number; restedLast: boolean };
  badges: Badge[];
  sentThisWeek: number;
  sentToday: number;
  /** Points earned today, across every deed. */
  xpToday: number;
  /** Turned in, and how many of those heard back with an interview or offer. */
  sent: number;
  heard: number;
}

export function useJourney(): Journey | undefined {
  return useLiveQuery(async () => {
    const [jobs, docs] = await Promise.all([db.jobs.toArray(), db.docs.toArray()]);
    const all = deeds(jobs, docs);
    const week = weekOf(new Date());
    // Dates in the data are ISO days, so today is too.
    const todayStr = day(Date.now());
    return {
      deeds: all,
      level: levelOf(all.reduce((n, d) => n + d.xp, 0)),
      run: run(all),
      badges: badges(jobs, docs, all),
      sentThisWeek: jobs.filter((j) => j.appliedAt && weekOf(j.appliedAt) === week).length,
      sentToday: jobs.filter((j) => j.appliedAt === todayStr).length,
      xpToday: all.filter((d) => d.at === todayStr).reduce((n, d) => n + d.xp, 0),
      sent: jobs.filter((j) => j.appliedAt).length,
      heard: jobs.filter((j) => j.appliedAt && (j.steps?.length || j.stage === 'interviewing' || j.stage === 'offer')).length,
    };
  }, []);
}
