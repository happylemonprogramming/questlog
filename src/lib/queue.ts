import type { Job } from './types';

/** How many roles "Next up" should hold: enough to keep going, few enough to not weigh on you. */
export const QUEUE_SIZE = 5;

/** Roles lined up to apply to, in the order camp offers them: batch by batch. */
export function lineup(jobs: Job[]): Job[] {
  const batches = new Map<string, Job[]>();
  for (const j of jobs.filter((j) => j.stage === 'next')) {
    const k = j.batch || 'Unbatched';
    batches.set(k, [...(batches.get(k) ?? []), j]);
  }
  return [...batches.values()].flat();
}

/** Roles you could line up next: new ones first, then the ones you saved most recently. */
export function candidates(jobs: Job[]): Job[] {
  const by = (stage: Job['stage']) => jobs.filter((j) => j.stage === stage).sort((a, b) => (a.moonshotRank ?? 99) - (b.moonshotRank ?? 99) || b.updatedAt - a.updatedAt);
  return [...by('inbox'), ...by('saved')];
}
