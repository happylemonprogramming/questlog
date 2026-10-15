import { getSettings } from './db';

/**
 * How the agent designs resumes and letters. The user can rewrite it in
 * Settings; this is what it says until they do.
 */
export const DEFAULT_DESIGN_GUIDE = `# Designing resumes and cover letters

Every application gets its own design, made for that company and that role. Start from a blank stylesheet each time instead of adapting an earlier design, unless the user asks to reuse one. A cover letter for the same listing matches its resume: copy_design, then adjust.

## Find the concept first
- Read the listing, and look at the company: its product, its website, its colors and type, the world its users live in.
- Pick one idea in a sentence before writing CSS. Examples: a game console company gets its controller's button shapes as section markers and its blue as the accent; an engineering firm gets a drawing sheet with a title block and numbered balloons; a space company gets a mission patch feel; an energy company gets a schematic or gauge motif.
- The idea should make a recruiter smile and still read as a serious resume in the first five seconds. Evoke the company with color, shape, type and layout. Don't use its logo unless the user asks, and never make the page look like it came from the company.

## Rules that never bend
- One US letter page: 816 x 1056 px (8.5in x 11in). Nothing spills onto page 2.
- Every word is real, selectable text in the markup. Applicant tracking systems (ATS) read the text, not the picture, so no words drawn in images, SVG or CSS content.
- Section headings keep standard words an ATS recognizes: Summary, Skills, Experience, Projects, Education, Certifications. A themed label (e.g. "Side Quests" over Projects) can be added with ::before or ::after content, which an ATS ignores, but the heading text itself stays standard.
- The document's order is the reading order an ATS sees. Keep experience early in the data, and place columns visually with CSS grid rather than putting a sidebar of skills first. Prefer one column for ATS-heavy portals (Workday, Taleo, iCIMS).
- Body text at least 9pt (12px), with contrast of at least 4.5:1. Light paper: a dark page looks striking on screen but prints badly.
- One or two typefaces. Google Fonts are fine; check they loaded in the preview.

## Make it, then look at it
1. Write the content with save_resume (or save_letter), choosing and ordering sections for this role.
2. Write the whole stylesheet with set_design, styling the markup described in get_design.
3. Call preview_document and look closely: overflow, clipped or overlapping text, awkward breaks, a single orphan word on a line, cramped or empty areas, low contrast, fonts that didn't load.
4. Fix with edit_design (or tighten the content), then preview again. Repeat until it is right.
5. Tell the user the idea in one sentence, so they can ask for more or less.`;

export async function getDesignGuide(): Promise<string> {
  return (await getSettings()).designGuide?.trim() || DEFAULT_DESIGN_GUIDE;
}
