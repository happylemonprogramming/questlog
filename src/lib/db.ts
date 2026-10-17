import Dexie, { type EntityTable } from 'dexie';
import { STAGE_LABEL, type Chat, type Doc, type ImageAsset, type Job, type Profile, type Settings, type SourceFile, type Stage } from './types';

/** Everything lives in this one IndexedDB database, on this device only. */
// Named for the app's first name, Offerdex, so existing data carries over.
export const db = new Dexie('offerdex') as Dexie & {
  jobs: EntityTable<Job, 'id'>;
  docs: EntityTable<Doc, 'id'>;
  chats: EntityTable<Chat, 'id'>;
  profile: EntityTable<Profile, 'id'>;
  settings: EntityTable<Settings, 'id'>;
  files: EntityTable<SourceFile, 'id'>;
  images: EntityTable<ImageAsset, 'name'>;
};

db.version(1).stores({
  jobs: 'id, stage, company, batch, moonshot, updatedAt',
  docs: 'id, kind, jobId, updatedAt',
  chats: 'id, updatedAt',
  profile: 'id',
  settings: 'id',
});

db.version(2).stores({
  files: 'id, bundle, path',
});

db.version(3).stores({
  images: 'name, updatedAt',
});

export const uid = () => crypto.randomUUID().slice(0, 8);
export const now = () => Date.now();
export const today = () => new Date().toISOString().slice(0, 10);

export const EMPTY_PROFILE: Profile = {
  id: 'me',
  name: '',
  rules: '',
  facts: '',
  style: '',
};

export const DEFAULT_SETTINGS: Settings = {
  id: 'settings',
  providers: [],
};

export async function getProfile(): Promise<Profile> {
  return (await db.profile.get('me')) ?? EMPTY_PROFILE;
}

export async function getSettings(): Promise<Settings> {
  return (await db.settings.get('settings')) ?? DEFAULT_SETTINGS;
}

/** The starter resume older versions put in a fresh install. */
export const SAMPLE_ID = 'sample-resume';

export async function upsertJob(patch: Partial<Job> & { id: string }): Promise<Job> {
  return db.transaction('rw', db.jobs, async () => {
    const prev = await db.jobs.get(patch.id);
    const next: Job = {
      company: '',
      title: '',
      location: '',
      stage: 'saved',
      createdAt: now(),
      ...prev,
      ...patch,
      updatedAt: now(),
    };
    await db.jobs.put(next);
    return next;
  });
}

export async function logJob(id: string, text: string) {
  const job = await db.jobs.get(id);
  if (!job) return;
  await db.jobs.update(id, { log: [...(job.log ?? []), { at: today(), text }], updatedAt: now() });
}

/** Move a listing to a stage, stamping the applied date the first time it's sent. */
export async function moveJob(job: Job, stage: Stage, note?: string) {
  await db.jobs.update(job.id, {
    stage,
    ...(stage === 'applied' && !job.appliedAt ? { appliedAt: today(), outcome: 'in_progress' as const } : {}),
    updatedAt: now(),
  });
  await logJob(job.id, note ?? `Moved to ${STAGE_LABEL[stage]}`);
}

/** Everything, as one JSON file the user owns. */
export async function exportAll() {
  return {
    app: 'questlog',
    version: 1,
    exportedAt: new Date().toISOString(),
    jobs: await db.jobs.toArray(),
    docs: await db.docs.toArray(),
    chats: await db.chats.toArray(),
    profile: await db.profile.toArray(),
    files: await db.files.toArray(),
    images: await db.images.toArray(),
    settings: (await db.settings.toArray()).map((s) => ({
      ...s,
      providers: s.providers.map(({ apiKey: _key, ...p }) => p),
    })),
  };
}
