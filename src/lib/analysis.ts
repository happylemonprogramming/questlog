import type { ImportResult } from './importers';

/** The request handed to the assistant after an upload that brought files it should read. */
export function analysisPrompt(r: ImportResult): string {
  const f = r.files!;
  const imported = [r.jobs && `${r.jobs} listings`, r.docs && `${r.docs} documents`, ...r.other].filter(Boolean).join(', ');
  return `I uploaded "${f.bundle}" (${f.stored} files).${imported ? ` Already imported automatically: ${imported}.` : ''}

Read the files that weren't imported and fill in Questlog from them. Start with any README, CONTEXT or summary file, since it explains the rest. Then:
1. Profile: contact details, search rules, the career record (every role, result, project, skill and link from resumes and CVs, in full and each once), confirmed facts, writing style. Add open questions, decisions, plans and next steps to the working notes. Merge with what's already there.
2. Listings: for each application or role the files mention, update its stage, batch, pay, strengths, gaps, flags, notes, applied date, outcome, interview steps and log. Save the full posting text as its description when a posting file is included. Create listings that don't exist yet only if the files clearly want them tracked.
3. Documents: turn each tailored resume, cover letter and short application answer into a Questlog document linked to its listing, with its content as written.
4. Mark each file when you're done with it.

Don't invent anything that isn't in the files. When you're done, give me a short summary of what you filled in, and list anything you couldn't place or that needs my answer.`;
}
