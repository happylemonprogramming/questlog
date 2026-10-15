import type { ChatMessage } from '@porygon/core';

/** Where a listing sits in the hunt. Order matters: it drives the pipeline board. */
export const STAGES = ['inbox', 'saved', 'next', 'applied', 'interviewing', 'offer', 'closed'] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  inbox: 'Inbox',
  saved: 'Saved',
  next: 'Next up',
  applied: 'Applied',
  interviewing: 'Interviewing',
  offer: 'Offer',
  closed: 'Closed',
};

export const INTERVIEW_STEPS = ['Phone screen', 'Technical', 'Case', 'Final round', 'Offer received'] as const;

export type Outcome = 'in_progress' | 'hired' | 'offer_declined' | 'rejected' | 'no_response' | 'interview_only' | 'skipped';

export interface Job {
  /** Stable key, e.g. `greenhouse:stripe:7844214`. */
  id: string;
  company: string;
  /** The company's own website, e.g. "anduril.com", for its logo. */
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
  createdAt: number;
  updatedAt: number;
}

export type DocKind = 'resume' | 'letter' | 'answer';

export interface Doc<T = unknown> {
  id: string;
  kind: DocKind;
  title: string;
  /** The listing this was written for. Base documents have none. */
  jobId?: string;
  /** A starting point other documents are tailored from. */
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
  /** Search rules the agent applies: pay floors, locations, seniority, travel. Markdown. */
  rules: string;
  /** Facts the agent may use in tailored documents, and only these. Markdown. */
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

export interface Settings {
  id: 'settings';
  providers: Provider[];
  activeProviderId?: string;
}
