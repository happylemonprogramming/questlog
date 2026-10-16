import type { ChatMessage } from '@porygon/core';

/** Where a listing sits in the hunt. Order matters: it drives the pipeline board. */
export const STAGES = ['inbox', 'saved', 'next', 'applied', 'interviewing', 'offer', 'closed'] as const;
export type Stage = (typeof STAGES)[number];

/** What the user sees: a quest log's words, kept plain enough to need no explaining. */
export const STAGE_LABEL: Record<Stage, string> = {
  inbox: 'Found',
  saved: 'Tracked',
  next: 'Up next',
  applied: 'Turned in',
  interviewing: 'In progress',
  offer: 'Offer',
  closed: 'Closed',
};

/**
 * The stages the app shows. Interviewing and Offer are kept in the data but
 * grouped under Applied for now, so there are fewer buckets to think about.
 */
export const SHOWN_STAGES = ['inbox', 'saved', 'next', 'applied', 'closed'] as const satisfies readonly Stage[];

export const shownStage = (s: Stage): Stage => (s === 'interviewing' || s === 'offer' ? 'applied' : s);

/** What each stage means, in a phrase. */
export const STAGE_HINT: Record<Stage, string> = {
  inbox: 'Heard about, not looked at yet',
  saved: 'Worth keeping, not applying yet',
  next: 'Applying soon; camp walks you through these',
  applied: 'Application sent',
  interviewing: 'Talking with them',
  offer: 'An offer is in',
  closed: 'Passed on, or finished',
};

export const INTERVIEW_STEPS = ['Phone screen', 'Technical', 'Case', 'Final round', 'Offer received'] as const;

export type Outcome = 'in_progress' | 'hired' | 'offer_declined' | 'rejected' | 'no_response' | 'interview_only' | 'skipped';

export interface Job {
  /** Stable key, e.g. `greenhouse:stripe:7844214`. */
  id: string;
  company: string;
  /** The company's own website, e.g. "anduril.com", which the agent reads when designing for it. */
  website?: string;
  title: string;
  location: string;
  url?: string;
  /** greenhouse | ashby | lever | workday | linkedin | manual … */
  portal?: string;
  /** Free-form pay text as shown to the user, e.g. "$150k–$190k + equity". */
  pay?: string;
  payMin?: number;
  payMax?: number;
  remote?: boolean;
  posted?: string;
  stage: Stage;
  /** A long-shot role worth applying to anyway, ranked separately. */
  moonshot?: boolean;
  moonshotRank?: number;
  /** A named group of roles to apply to together, e.g. "spring push". */
  batch?: string;
  /** Why it fits. */
  strengths?: string[];
  /** Where it falls short, or what to watch out for. */
  gaps?: string[];
  /** Short warnings: "competitor", "pay not listed", "25% travel"… */
  flags?: string[];
  verdict?: string;
  notes?: string;
  /** Posting text, markdown. */
  description?: string;
  appliedAt?: string;
  outcome?: Outcome;
  /** Interview steps reached, from INTERVIEW_STEPS. */
  steps?: string[];
  /** Dated log lines. */
  log?: { at: string; text: string }[];
  /** The application form, filled in ahead and waiting for the user to review and submit. */
  application?: Application;
  createdAt: number;
  updatedAt: number;
}

export type AnswerKind = 'text' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'file' | 'combobox';

/** One question on an application form and what goes in it. */
export interface FormAnswer {
  /** The question as the form words it; how the answer finds its field again. */
  label: string;
  kind: AnswerKind;
  value: string | boolean | string[];
  required?: boolean;
  /** The choices, for a select, radio group or checkbox group. */
  options?: string[];
  /** For an upload: the document that goes in it. */
  docId?: string;
  /** Left for the user, and why the guide didn't answer it. */
  ask?: string;
  /** Which page of a multi-page form it's on, from 1. */
  step?: number;
}

/**
 * An application prepared ahead: the form's questions and their answers, so
 * the user can read them in Questlog and send it with one press. Kept in the
 * job's folder as application.json.
 */
export interface Application {
  /** The form it was read from. */
  url: string;
  answers: FormAnswer[];
  /** What the guide wants the user to know before sending. */
  note?: string;
  /** ISO time it was prepared. */
  preparedAt: string;
}

export type DocKind = 'resume' | 'letter' | 'answer';

export interface Doc<T = unknown> {
  id: string;
  kind: DocKind;
  title: string;
  /** The listing this was written for. Base documents have none. */
  jobId?: string;
  /** From before the career record: a resume others were tailored from. No longer used. */
  base?: boolean;
  /** Short tag such as "mechanical" or "software". */
  variant?: string;
  data: T;
  /** The sheet's stylesheet. Without one it uses the default design. */
  css?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AnswerData {
  /** The question on the application form, if any. */
  prompt?: string;
  text: string;
}

/** A chat thread. `messages` is the agent transcript, without the system prompt. */
export interface Chat {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface Profile {
  id: 'me';
  name: string;
  headline?: string;
  location?: string;
  email?: string;
  phone?: string;
  links?: { label: string; href: string }[];
  /** The lowest yearly pay the user would take, in the same units as a listing's payMin and payMax. Sets the pay sign. */
  payFloor?: number;
  /** Search rules the agent applies: pay floors, locations, seniority, travel. Markdown. */
  rules: string;
  /** Everything the user has done, in full: roles, results, projects, skills. Every resume is written from it. Markdown. */
  history?: string;
  /** Other facts the agent may use in documents. With the career record, the only source it may use. Markdown. */
  facts: string;
  /** Voice and writing preferences. Markdown. */
  style: string;
  /** Open questions, decisions and next steps. Markdown. */
  notes?: string;
}

/** A file brought in with an upload, kept so the assistant can read it. */
export interface SourceFile {
  /** `<bundle>/<path>`. */
  id: string;
  /** The upload it came with, e.g. the zip's name. */
  bundle: string;
  path: string;
  size: number;
  /** Text content; absent for binary files such as PDFs. */
  text?: string;
  /** How it was used: "imported 150 listings", "analyzed: profile, 2 listings"… */
  status?: string;
  createdAt: number;
}

export interface Provider {
  id: string;
  name: string;
  baseURL: string;
  apiKey?: string;
  model?: string;
}

/** Who runs the agent: the built-in one with a provider, or a coding agent in the desktop app. */
export type EngineChoice = 'builtin' | 'claude' | 'codex' | 'opencode' | 'goose';

export interface Settings {
  id: 'settings';
  providers: Provider[];
  /** Desktop only. Unset means the built-in agent. */
  engine?: EngineChoice;
  /** Per engine, preferred session options such as the model: { claude: { model: 'opus' } }. */
  engineOptions?: Partial<Record<EngineChoice, Record<string, string>>>;
  activeProviderId?: string;
  /** The user's own design guide for the agent. Unset means DEFAULT_DESIGN_GUIDE. */
  designGuide?: string;
}
