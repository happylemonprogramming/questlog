import { getSettings } from './db';

/**
 * How the agent designs resumes and letters. The user can rewrite it in
 * Settings; this is what it says until they do.
 */
export const DEFAULT_DESIGN_GUIDE = `# Designing resumes and cover letters

Every application gets its own design, made for that company and that role. Two resumes for different companies should be unmistakable side by side, even as thumbnails: different layout, different type, different color, not the same page recolored. A cover letter for the same listing matches its resume: copy_design, then adjust.

## Research the brand
- Look at the company's own website with view_website (in the desktop app; otherwise use your web tools). Note its real colors in hex, its typefaces, and its mood: dark or light, dense or airy, playful or austere, big type or small.
- For a proprietary typeface, pick the closest Google Font (e.g. Helvetica Now: Inter Tight or Archivo; a geometric grotesk: Space Grotesk or Manrope; a serif wordmark: Fraunces or Playfair Display).
- Look at the listing too: the role and the team say what to put first.

## Explore, then commit
- Start from nothing. Don't adapt the default design or any design you made earlier, including earlier in this conversation. A new document has no design on purpose.
- Write a short brief for yourself before any CSS: the concept in a sentence, the palette (from their site), the typefaces, the layout, and one signature detail a recruiter at that company would recognize.
- Choose the layout to fit the company, and make it a different layout from the last design you made. Some starting points, not a list to cycle through:
  - Editorial: oversized name, a serif or a striking display face, generous margins, one column with thin rules.
  - Swiss grid: section labels in a narrow left column, everything flush left, strict spacing, few colors.
  - Sidebar: a tinted side column for contact, skills and education beside the experience (put experience first in the data and place the sidebar with CSS grid).
  - Banner: a full-width block of brand color across the top holding the name and headline.
  - Product: the company's interface language, e.g. cards, pills, a stats row with real numbers from the record.
  - Terminal or mono: monospace structure for developer and crypto companies.
  - Technical sheet: a drawing frame with a title block for hardware and engineering firms.
- Evoke the company with color, shape, type and layout. Don't use its logo unless the user asks, and never make the page look like it came from the company.

## Rules that never bend
- One US letter page: 816 x 1056 px (8.5in x 11in). Nothing spills onto page 2.
- Every word is real, selectable text in the markup. Applicant tracking systems (ATS) read the text, not the picture, so no words drawn in images, SVG or CSS content.
- Section headings keep standard words an ATS recognizes: Summary, Skills, Experience, Projects, Education, Certifications. A themed label (e.g. "Side Quests" over Projects) can be added with ::before or ::after content, which an ATS ignores, but the heading text itself stays standard.
- The document's order is the reading order an ATS sees. Keep experience early in the data, and place columns visually with CSS grid rather than putting a sidebar of skills first. Prefer one column for ATS-heavy portals (Workday, Taleo, iCIMS).
- Body text at least 9pt (12px), with contrast of at least 4.5:1. A dark page is fine when the brand is dark.
- One or two typefaces. Google Fonts are fine; check they loaded in the preview.

## Make it, then look at it
1. Write the content with save_resume (or save_letter), choosing and ordering sections for this role.
2. Write the whole stylesheet with set_design, styling the markup described in design_guide. Hide the parts your concept doesn't use.
3. Call preview_document and look closely: overflow, clipped or overlapping text, awkward breaks, a single orphan word on a line, cramped or empty areas, low contrast, fonts that didn't load.
4. Fix with edit_design (or tighten the content), then preview again. Repeat until it is right.
5. Tell the user the idea in one sentence and what you took from their site, so they can ask for more or less.`;

export async function getDesignGuide(): Promise<string> {
  return (await getSettings()).designGuide?.trim() || DEFAULT_DESIGN_GUIDE;
}
