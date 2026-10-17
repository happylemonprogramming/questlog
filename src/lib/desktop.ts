/**
 * The desktop app's bridge, when Questlog runs inside it (desktop/src/preload.ts).
 * The web app works without it; features that need the desktop check
 * `isDesktop()` first.
 */

export type EngineId = 'claude' | 'codex' | 'opencode' | 'goose';

export interface Engine {
  id: EngineId;
  label: string;
  note: string;
  available: boolean;
  missing?: string;
  /** Set when the engine is installed but not logged in: how to log in. */
  login?: string;
}

export interface FormField {
  ref: string;
  kind: 'text' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'file' | 'combobox';
  label: string;
  type?: string;
  required?: boolean;
  value?: unknown;
  options?: string[];
  accept?: string;
  multiple?: boolean;
}

export interface FormButton {
  ref: string;
  text: string;
  submits: boolean;
}

export interface ConfigOption {
  id: string;
  name: string;
  category?: string | null;
  type: 'select' | 'boolean';
  currentValue: string | boolean;
  options?: ({ value: string; name: string; description?: string | null } | { group: string; name: string; options: { value: string; name: string }[] })[];
}

/** An update from the agent's session (ACP session/update), as the engine sent it. */
export interface ToolUpdate {
  sessionUpdate: 'tool_call' | 'tool_call_update';
  toolCallId: string;
  title?: string | null;
  kind?: string | null;
  status?: string | null;
  rawInput?: unknown;
  rawOutput?: unknown;
  content?: { type: string; content?: { type: string; text?: string } }[] | null;
}

export type AgentUpdate =
  | { sessionUpdate: 'agent_message_chunk' | 'agent_thought_chunk' | 'user_message_chunk'; content: { type: string; text?: string } }
  | ToolUpdate
  | { sessionUpdate: 'plan' | 'usage_update' | 'current_mode_update' | 'session_info_update' | 'available_commands_update' | 'config_option_update' };

export interface PermissionAsk {
  id: string;
  chatId: string;
  title?: string | null;
  kind?: string | null;
  input?: unknown;
  options: { optionId: string; name: string; kind: string }[];
}

type Off = () => void;

export interface SiteLook {
  title: string;
  url: string;
  themeColor: string | null;
  backgrounds: string[];
  text: string[];
  accents: string[];
  fonts: string[];
  images: string[];
  mimeType: string;
}

export interface WorkspaceInfo {
  root: string | null;
  defaultRoot: string;
  /** Off when the folder is already inside the user's own git repository. */
  history: boolean;
}

/** A text file, or with `base64`, an image in images/. */
export interface WsFile {
  path: string;
  text?: string;
  base64?: string;
}

export interface Snapshot {
  oid: string;
  message: string;
  at: number;
}

export interface ToolImage {
  data: string;
  mimeType: string;
}

export interface LocalEntry {
  /** Relative to the listed folder, with forward slashes. */
  path: string;
  type: 'file' | 'dir';
  size?: number;
}

export interface LocalListing {
  root: string;
  entries: LocalEntry[];
  /** Entries left out: secrets, dependencies, build output, ignored files, links leading out. */
  hidden: number;
  truncated: boolean;
}

export interface LocalRead {
  path: string;
  size: number;
  binary: boolean;
  text?: string;
  from?: number;
  to?: number;
  lines?: number;
}

export interface LocalHit {
  path: string;
  nameMatch: boolean;
  lines: { line: number; text: string }[];
}

export interface RepoSummary {
  name: string;
  path: string;
  remote?: string;
  commits: number;
  emails: string[];
  total: number;
  capped?: boolean;
  first?: string;
  last?: string;
  languages: { language: string; files: number }[];
  subjects: { date: string; subject: string }[];
  /** The most frequent authors, when none of the user's emails matched. */
  authors?: { email: string; commits: number }[];
  error?: string;
}

export interface GitHistory {
  emails: string[];
  backend: 'git' | 'isomorphic-git';
  repos: RepoSummary[];
  truncated: boolean;
  ms: number;
}

export interface DesktopBridge {
  version: string;
  platform: string;
  /** Open the folder with the desktop app's log. */
  openLogs(): Promise<string>;
  /** The workspace folder that holds the user's files (desktop/src/workspace.ts). */
  workspace: {
    info(): Promise<WorkspaceInfo>;
    choose(): Promise<WorkspaceInfo | null>;
    useDefault(): Promise<WorkspaceInfo>;
    reveal(): Promise<void>;
    readAll(): Promise<WsFile[]>;
    read(paths: string[]): Promise<{ path: string; text: string | null }[]>;
    write(files: WsFile[], message: string): Promise<number>;
    remove(paths: string[], message: string): Promise<void>;
    onChanged(fn: (msg: { paths: string[] }) => void): Off;
  };
  /** Snapshots of the workspace, shown as History and Undo. */
  history: {
    list(): Promise<Snapshot[]>;
    restore(oid: string): Promise<string | null>;
    /** Returns what was undone. */
    undo(): Promise<string | null>;
    clear(): Promise<void>;
  };
  /** Records kept under the app's first name, Offerdex, read once so they carry over. */
  legacy: {
    data(): Promise<Record<string, unknown[]> | null>;
    taken(): Promise<void>;
  };
  /** A website's look: screenshots (base64) plus the colors and fonts it uses. */
  viewSite(url: string): Promise<SiteLook>;
  /** A picture from the web, fetched outside the page's cross-origin rules. */
  fetchImage(url: string): Promise<{ type: string; base64: string; url: string }>;
  /** Folders on this computer the user lets the agent read (desktop/src/local.ts). */
  local: {
    /** Opens a folder picker; null when the user cancels. */
    grant(): Promise<{ folder: string; grants: string[] } | null>;
    grants(): Promise<string[]>;
    revoke(folder: string): Promise<string[]>;
    list(path?: string, depth?: number): Promise<LocalListing[]>;
    read(path: string, offset?: number, limit?: number): Promise<LocalRead>;
    readImage(path: string): Promise<{ name: string; type: string; base64: string }>;
    search(query: string, path?: string): Promise<{ query: string; results: LocalHit[]; scanned: number; truncated: boolean }>;
    git(path?: string, opts?: { emails?: string[] }): Promise<GitHistory>;
  };
  pdf: {
    make(docId: string, fileName?: string): Promise<{ path: string; name: string }>;
    save(docId: string, fileName?: string): Promise<string | null>;
    reveal(file: string): Promise<void>;
    /** The PDF's page count and a JPEG of the document as printed, base64. */
    preview(docId: string): Promise<{ pages: number; image: string; mimeType: string }>;
  };
  form: {
    status(): Promise<{ open: boolean; url?: string; loading?: boolean }>;
    read(): Promise<{ url: string; title: string; fields: FormField[]; buttons: FormButton[] }>;
    fill(fields: { ref: string; value: unknown }[]): Promise<{ ref: string; ok: boolean; note?: string; chose?: string }[]>;
    click(ref: string): Promise<{ ok: boolean; note?: string; refused?: boolean }>;
    text(): Promise<{ url: string; title: string; text: string }>;
    /** Press the form's submit button. Only for the user's own press; never exposed to the agent. */
    submit(): Promise<{ ok: boolean; label?: string; note?: string }>;
    attach(ref: string, docId: string, fileName?: string): Promise<{ ok: boolean; note?: string; file?: string }>;
  };
  agent: {
    engines(): Promise<Engine[]>;
    prompt(req: { chatId: string; engine: EngineId; text: string; system: string; options?: Record<string, string> }): Promise<{ stopReason?: string; error?: string; auth?: boolean }>;
    cancel(chatId: string): Promise<void>;
    forget(chatId: string): Promise<void>;
    answer(id: string, optionId: string | null): Promise<void>;
    setOption(chatId: string, configId: string, value: string): Promise<ConfigOption[] | null>;
    onUpdate(fn: (msg: { chatId: string; update: AgentUpdate }) => void): Off;
    onPermission(fn: (msg: PermissionAsk) => void): Off;
    onSession(fn: (msg: { chatId: string; engine: EngineId; configOptions: ConfigOption[] }) => void): Off;
    onExit(fn: (msg: { engine: EngineId; code: number; stderr: string }) => void): Off;
  };
  serveTools(handler: { list(): Promise<unknown>; call(name: string, args: unknown): Promise<{ text: string; isError?: boolean; images?: ToolImage[] }> }): Off;
}

declare global {
  interface Window {
    questlogDesktop?: DesktopBridge;
  }
}

export const desktop = (): DesktopBridge | undefined => window.questlogDesktop;
export const isDesktop = () => !!window.questlogDesktop;
