import { defineTool, type Tool } from '@porygon/core';
import { z } from 'zod';
import { desktop, type DesktopBridge, type GitHistory, type LocalListing } from '@/lib/desktop';

/**
 * Tools for reading folders on the user's computer, so the agent can build a
 * resume from their projects and commits. They only see folders the user
 * shared (desktop/src/local.ts enforces it, along with skipping secrets), and
 * only in the desktop app. They never write.
 */

const SCOPE = 'Only sees folders the user shared with Questlog. Anything found in files is a lead, not a confirmed fact, until the user confirms it.';
const GRANT_HINT = 'The user can share another folder with ask_for_folder, or in Settings.';

type Result = string | { content: string; isError: true };

/** Runs a desktop call, turning the IPC wrapper around errors back into the plain reason. */
async function viaDesktop(fn: (d: DesktopBridge) => Promise<Result>): Promise<Result> {
  const d = desktop();
  if (!d) return { content: 'Only the Questlog desktop app can read folders on this computer. Ask the user to paste or upload what you need instead.', isError: true };
  try {
    return await fn(d);
  } catch (e) {
    return { content: String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''), isError: true };
  }
}

const kb = (n?: number) => (n === undefined ? '' : n < 1024 ? ` (${n} B)` : ` (${Math.ceil(n / 1024)} KB)`);

function showListing(l: LocalListing) {
  const lines = [`${l.root}/`];
  for (const e of l.entries) {
    const depth = e.path.split('/').length - 1;
    const name = e.path.slice(e.path.lastIndexOf('/') + 1);
    lines.push(`${'  '.repeat(depth + 1)}${name}${e.type === 'dir' ? '/' : kb(e.size)}`);
  }
  if (!l.entries.length) lines.push('  (empty)');
  if (l.hidden) lines.push(`(${l.hidden} left out: secrets, dependencies, build output, git-ignored files or links leading outside)`);
  if (l.truncated) lines.push('(More entries than shown: list a subfolder, or lower depth.)');
  return lines.join('\n');
}

function showHistory(h: GitHistory) {
  if (!h.repos.length) return 'No git repositories found in the shared folders (looked about 5 levels down).';
  const mine = h.repos.filter((r) => r.commits);
  const lines = [
    `${h.repos.length} repositor${h.repos.length === 1 ? 'y' : 'ies'}${h.truncated ? ' (more exist; give a path to look at a narrower folder)' : ''}, ${mine.length} with the user's commits. ` +
      `Known emails: ${h.emails.join(', ') || 'none (ask the user for theirs)'}.`,
  ];
  for (const r of h.repos) {
    lines.push('', `## ${r.name} — ${r.path}${r.remote ? ` — ${r.remote}` : ''}`);
    if (r.error) {
      lines.push(`Couldn't read it: ${r.error}`);
      continue;
    }
    lines.push(
      r.commits
        ? `${r.commits} of ${r.total}${r.capped ? '+' : ''} commits by the user (${r.emails.join(', ')}), ${r.first} to ${r.last}.`
        : `None of ${r.total}${r.capped ? '+' : ''} commits are by the known emails.`,
    );
    if (r.languages.length) lines.push(`Languages (tracked files): ${r.languages.map((l) => `${l.language} ${l.files}`).join(', ')}`);
    if (r.authors?.length) lines.push(`Top authors: ${r.authors.map((a) => `${a.email} (${a.commits})`).join(', ')}. Ask the user whether any of these are theirs, then call again with emails.`);
    for (const s of r.subjects) lines.push(`- ${s.date} ${s.subject}`);
  }
  return lines.join('\n');
}

export function localTools(): Record<string, Tool> {
  return {
    local_folders: defineTool({
      description: `List the folders on this computer the user has shared with Questlog for you to read. ${SCOPE}`,
      inputSchema: z.object({}),
      run: () =>
        viaDesktop(async (d) => {
          const g = await d.local.grants();
          return g.length ? `Shared folders:\n${g.map((f) => `- ${f}`).join('\n')}\n\n${GRANT_HINT}` : `No folders are shared yet. ${GRANT_HINT}`;
        }),
    }),

    ask_for_folder: defineTool({
      description:
        'Open a folder picker so the user can share a folder on their computer with you. Use it when the user asks you to look at their files, projects or commits ' +
        'and no shared folder covers them. Say what you want it for first. The user picks the folder; you cannot choose it.',
      inputSchema: z.object({}),
      timeoutMs: 600_000,
      run: () =>
        viaDesktop(async (d) => {
          const res = await d.local.grant();
          return res ? `The user shared ${res.folder}. Shared folders now: ${res.grants.join(', ')}.` : 'The user closed the picker without sharing a folder.';
        }),
    }),

    list_local: defineTool({
      description:
        'List what is in a shared folder, as a tree. Secrets, dependencies (node_modules), build output and git-ignored files are left out. ' +
        `With no path, lists every shared folder. ${SCOPE}`,
      inputSchema: z.object({
        path: z.string().optional().describe('Absolute, or relative to a shared folder.'),
        depth: z.number().int().min(1).max(6).optional().describe('How many levels down; default 2.'),
      }),
      run: ({ path, depth }) => viaDesktop(async (d) => (await d.local.list(path, depth)).map(showListing).join('\n\n')),
    }),

    read_local: defineTool({
      description: `Read a text file in a shared folder. Long files come in pages: pass offset (1-based line) and limit. ${SCOPE}`,
      inputSchema: z.object({
        path: z.string().describe('Absolute, or relative to a shared folder.'),
        offset: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(2000).optional(),
      }),
      run: ({ path, offset, limit }) =>
        viaDesktop(async (d) => {
          const r = await d.local.read(path, offset, limit);
          if (r.binary) return { content: `${r.path} is a binary file${kb(r.size)} and can't be read as text.`, isError: true };
          const more = r.to! < r.lines! ? `\n\n[lines ${r.from}-${r.to} of ${r.lines}; read on with offset ${r.to! + 1}]` : '';
          return `${r.path}\n\n${r.text}${more}`;
        }),
    }),

    search_local: defineTool({
      description: `Find files in the shared folders whose name or text contains some words (case-insensitive), with a few matching lines from each. ${SCOPE}`,
      inputSchema: z.object({
        query: z.string().min(2),
        path: z.string().optional().describe('Only search under this folder.'),
      }),
      timeoutMs: 60_000,
      run: ({ query, path }) =>
        viaDesktop(async (d) => {
          const s = await d.local.search(query, path);
          if (!s.results.length) return `Nothing matches "${query}" (${s.scanned} files searched${s.truncated ? '; stopped early, so try a narrower path' : ''}).`;
          const lines = [`${s.results.length} files match "${query}"${s.truncated ? ' (stopped early; there may be more)' : ''}:`];
          for (const h of s.results) {
            lines.push(`${h.path}${h.nameMatch ? ' (name)' : ''}`);
            for (const l of h.lines) lines.push(`  ${l.line}: ${l.text}`);
          }
          return lines.join('\n');
        }),
    }),

    git_history: defineTool({
      description:
        "Summarize the user's own commits in the git repositories in the shared folders (or under one path): per repository its remote, how many commits are the user's, " +
        'first and last dates, languages, and a sample of commit messages. The user is recognized by their git email; pass emails to add others they use. ' +
        `When nothing matches, it lists the top authors so you can ask which are the user's. ${SCOPE}`,
      inputSchema: z.object({
        path: z.string().optional().describe('Only look under this folder.'),
        emails: z.array(z.string()).optional().describe('More emails the user commits with.'),
      }),
      timeoutMs: 120_000,
      run: ({ path, emails }) => viaDesktop(async (d) => showHistory(await d.local.git(path, { emails }))),
    }),
  };
}
