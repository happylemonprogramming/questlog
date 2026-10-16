import DEFAULT_CSS from '@/styles/sheet.css?raw';
import { db } from './db';
import type { DocKind } from './types';

/**
 * A document's design is one stylesheet, like the CSS file of a resume
 * website. Each sheet renders in its own shadow root, so a design styles the
 * page and nothing else in the app. Documents without one use DEFAULT_CSS.
 */
export { DEFAULT_CSS };

export const designOf = (css: string | undefined) => (css?.trim() ? css : DEFAULT_CSS);

/** Stands in for the app's Tailwind preflight, which doesn't reach into a shadow root. */
const RESET = `
:host { all: initial; display: block; line-height: 1.5; -webkit-text-size-adjust: 100%; tab-size: 4; font-family: ui-sans-serif, system-ui, sans-serif; }
*, ::before, ::after { box-sizing: border-box; border: 0 solid currentColor; }
blockquote, dl, dd, h1, h2, h3, h4, h5, h6, hr, figure, p, pre { margin: 0; }
h1, h2, h3, h4, h5, h6 { font-size: inherit; font-weight: inherit; }
ol, ul, menu { list-style: none; margin: 0; padding: 0; }
a { color: inherit; text-decoration: inherit; }
b, strong { font-weight: bolder; }
small { font-size: 80%; }
sub, sup { font-size: 75%; line-height: 0; position: relative; vertical-align: baseline; }
sub { bottom: -0.25em; } sup { top: -0.5em; }
table { text-indent: 0; border-color: inherit; border-collapse: collapse; }
img, svg, video { display: block; vertical-align: middle; max-width: 100%; height: auto; }
hr { height: 0; color: inherit; border-top-width: 1px; }
`;

const FONT_CSS = /^https:\/\/fonts\.googleapis\.com\//;
const FONT_FILE = /^https:\/\/fonts\.gstatic\.com\//;
const PAGE_RULE = /@page[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/gi;

export interface CleanCss {
  css: string;
  /** Google Fonts stylesheets to load into the document. */
  imports: string[];
  /** @font-face rules, which only take effect at document level. */
  fontFaces: string[];
  /** URLs that were dropped because they would load from elsewhere. */
  blocked: string[];
}

/**
 * Keep a design from loading anything off the page. A stylesheet can reach
 * the network through url(), @import and image-set(); allow inline data: URLs,
 * plus Google Fonts so a design can pick a typeface.
 */
export function cleanCss(src: string): CleanCss {
  const imports: string[] = [];
  const fontFaces: string[] = [];
  const blocked: string[] = [];
  const urls = (css: string, ok: (u: string) => boolean) =>
    css.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (m, _q, u: string) => {
      if (/^data:/i.test(u) || ok(u)) return m;
      blocked.push(u);
      return 'url("")';
    });
  let css = src.replace(/@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)\1\s*\)?[^;]*;/gi, (_m, _q, u: string) => {
    (FONT_CSS.test(u) ? imports : blocked).push(u);
    return '';
  });
  css = css.replace(/@font-face\s*\{[^}]*\}/gi, (m) => {
    fontFaces.push(urls(m, (u) => FONT_FILE.test(u)));
    return '';
  });
  css = urls(css, () => false).replace(/image-set\(/gi, 'image-set-blocked(');
  return { css, imports, fontFaces, blocked };
}

const URL_IN = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;

/** Whether every url() in a value is allowed; image-set() never is. */
const safeValue = (v: string, ok: (u: string) => boolean) =>
  !/image-set\(/i.test(v) && [...v.matchAll(URL_IN)].every(([, , u]) => /^data:/i.test(u) || ok(u));

function scrubStyle(style: CSSStyleDeclaration, ok: (u: string) => boolean) {
  for (const prop of [...style]) if (!safeValue(style.getPropertyValue(prop), ok)) style.removeProperty(prop);
}

/**
 * A second pass over the parsed stylesheet. The browser has already decoded
 * CSS escapes here, so a url() spelled with them (\75 rl(...)) shows up as
 * the url() it is, which the text pass above can't see.
 */
function scrubRules(rules: CSSRuleList, ok: (u: string) => boolean = () => false) {
  for (const rule of [...rules]) {
    if ('style' in rule) scrubStyle((rule as CSSStyleRule).style, ok);
    if ('cssRules' in rule) scrubRules((rule as CSSGroupingRule).cssRules, ok);
  }
}

/** One rule, or a few, cleaned and scrubbed, as text for a document-level <style>. */
function scrubbedText(css: string, ok?: (u: string) => boolean) {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  scrubRules(sheet.cssRules, ok);
  return [...sheet.cssRules].map((r) => r.cssText).join('\n');
}

/** The design's @page rules, which only apply at document level (the print view). */
export const pageRules = (css: string | undefined) => scrubbedText(cleanCss((designOf(css).match(PAGE_RULE) ?? []).join('\n')).css);

const loaded = new Set<string>();
const pending: Promise<unknown>[] = [];

/** Fonts a design asks for have to be declared on the document, not in the shadow root. */
function hoist({ imports, fontFaces }: CleanCss) {
  for (const href of imports) {
    if (loaded.has(href)) continue;
    loaded.add(href);
    const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href });
    pending.push(new Promise((r) => { link.onload = link.onerror = r; }));
    document.head.appendChild(link);
  }
  for (const rule of fontFaces) {
    if (loaded.has(rule)) continue;
    loaded.add(rule);
    const style = document.createElement('style');
    style.textContent = scrubbedText(rule, (u) => FONT_FILE.test(u));
    document.head.appendChild(style);
  }
}

/** Resolves once every font a design asked for has loaded, or after a few seconds offline. */
export async function fontsReady() {
  await Promise.race([Promise.all(pending), new Promise((r) => setTimeout(r, 4000))]);
  await document.fonts.ready;
}

let reset: CSSStyleSheet | undefined;
const sheets = new Map<string, CSSStyleSheet>();

/**
 * Parsed stylesheets for a design, shared by every sheet that uses it. The
 * Documents grid shows many sheets with one or two designs, so each design
 * is parsed once.
 */
export function sheetStyles(css: string | undefined): CSSStyleSheet[] {
  if (!reset) {
    reset = new CSSStyleSheet();
    reset.replaceSync(RESET);
  }
  const src = designOf(css);
  let sheet = sheets.get(src);
  if (!sheet) {
    const clean = cleanCss(src);
    hoist(clean);
    sheet = new CSSStyleSheet();
    sheet.replaceSync(clean.css);
    scrubRules(sheet.cssRules);
    sheets.set(src, sheet);
    // Typing in the design editor makes a new stylesheet per pause; keep the recent ones.
    if (sheets.size > 24) sheets.delete(sheets.keys().next().value!);
  } else {
    sheets.delete(src);
    sheets.set(src, sheet);
  }
  return [reset, sheet];
}

const TAGS = new Set(
  'a abbr b br caption code col colgroup dd del div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hr i img ins kbd li mark ol p pre q s section small span strong sub sup table tbody td tfoot th thead time tr u ul'.split(' '),
);
const DROP = new Set('script style iframe frame frameset object embed template noscript link meta base form input button textarea select svg math audio video canvas'.split(' '));
const ATTRS = new Set(['class', 'style', 'href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'width', 'height', 'role', 'datetime']);

/**
 * Markup for a custom block, reduced to inert layout: no scripts, handlers,
 * forms or embeds, links open in a new tab, and images must be inline data.
 */
export function cleanHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const walk = (el: Element) => {
    for (const child of [...el.children]) {
      const tag = child.tagName.toLowerCase();
      if (DROP.has(tag)) { child.remove(); continue; }
      walk(child);
      if (!TAGS.has(tag)) { child.replaceWith(...child.childNodes); continue; }
      for (const { name, value } of [...child.attributes]) {
        const keep =
          name.startsWith('aria-') ||
          (ATTRS.has(name) &&
            (name !== 'href' || /^(https?:|mailto:|tel:|#)/i.test(value.trim())) &&
            (name !== 'src' || /^data:image\/(png|jpe?g|gif|webp|svg\+xml)[;,]/i.test(value.trim())));
        if (!keep) child.removeAttribute(name);
        else if (name === 'style') child.setAttribute('style', cleanCss(value).css);
      }
      if (child instanceof HTMLElement) scrubStyle(child.style, () => false);
      if (tag === 'a') {
        child.setAttribute('target', '_blank');
        child.setAttribute('rel', 'noopener noreferrer');
      }
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

/**
 * The design a new document starts with. A letter takes its listing's resume
 * design so the pair matches; a resume starts from the default and gets its own.
 */
export async function inheritedDesign(kind: DocKind, jobId?: string): Promise<string | undefined> {
  if (kind !== 'letter' || !jobId) return undefined;
  return (await db.docs.where('jobId').equals(jobId).toArray()).find((d) => d.kind === 'resume')?.css;
}

/** How the sheet's markup is built, so a design can target it. Shown to the assistant with get_design. */
export const MARKUP_GUIDE = `Markup the stylesheet styles. It renders in its own shadow root after a small reset (like Tailwind's preflight: no margins, unstyled lists and links), so no app styles apply.
Some elements exist for one particular look (an engineering drawing sheet): the crop marks, the title block (DOC/REV/SHEET), the numbered balloons in headings, the eyebrow separator and the notes footer. They are not the house style. Hide them with display: none unless your concept uses them; otherwise the title block shows as loose text and balloons as stray numbers.
<div class="dark">  (class only while the app is in dark mode; designs may ignore it)
 <div class="resume-container">  (letters: "resume-container letter-sheet"). One US letter page is 816 x 1056 px (8.5in x 11in); content taller than that spills onto page 2.
  <span class="crop crop-tl"/> crop-tr, crop-bl, crop-br  (corner marks)
  <div class="ats-keywords"><span/></div>  (hidden keywords for applicant tracking; keep it hidden)
  <header class="sheet-header">
   <div class="header-text">
    <p class="eyebrow">Role A <span class="eyebrow-sep">/</span> Role B</p>
    <h1 class="name-title">Name</h1>
    <div class="contact-info"><a/> or <span/>, separated by <span class="divider">•</span></div>
   </div>
   <dl class="title-block"><div class="tb-cell"><dt>DOC</dt><dd>RESUME</dd></div> then REV and SHEET cells</dl>
  </header>
  Resume, once per section, in data order. If any section sets \`column\`, sections are grouped instead into
  <div class="sheet-column" data-column="main|side|..."> wrappers (in order of first appearance) for side-by-side layouts:
  <section class="resume-section {section.class}" data-kind="text|skills|experience|projects|education|html">
   <h2 class="section-title"><span class="balloon">1</span>Title</h2>  (left out when the title is "")
   text: <p class="objective-text"/>
   skills: <div class="skills-row"><span class="skills-label"/><div class="skills-badges"><span class="skill-badge"/>...</div></div>
   experience: <div class="company-header"><p class="company-info"/></div>
     <div class="job-item"><div class="job-header"><h3 class="job-title">Title <span class="active-badge">ACTIVE</span></h3><span class="job-date"/></div><ul class="job-duties"><li/>...</ul></div>
   projects: <div class="projects-grid"><div class="project-card"><div class="project-card-header"><h3 class="project-card-title"/><span class="project-card-date"/><a class="project-card-link"/></div><p class="project-card-award"/><p class="project-card-desc"/><p class="project-card-stack"/></div>...</div>
   education: <div class="education-item"><div class="education-header"><h3 class="degree-title">Degree<span class="school-name"> • School</span></h3><span class="grad-date"/></div></div>
   html: <div class="html-block">{the section's own markup}</div>
  </section>
  <footer class="sheet-notes"><span class="notes-label"/><ol><li/>...</ol></footer>
  Letter, after the header:
  <dl class="transmittal"><div class="tx-cell"><dt>DATE</dt><dd/></div><div class="tx-cell tx-to"><dt>TO</dt><dd>Name<span class="tx-sub"> • Company</span></dd></div><div class="tx-cell tx-re"><dt>RE</dt><dd/></div></dl>
  <article class="letter-body"><p class="letter-salutation"/><p/>(opening)<ol class="letter-points"><li><span class="balloon"/><p><strong>Lead.</strong> text</p></li></ol><p/>...(body, closing)<div class="letter-signoff"><p/><p class="signature"/></div></article>
  <footer class="sheet-notes"> (enclosures)
 </div>
</div>
Fonts: system fonts, the bundled 'Inter Variable' and 'JetBrains Mono Variable', or Google Fonts via @import url("https://fonts.googleapis.com/css2?family=..."). Other url()s only work as data: URLs.
@media print styles apply to the PDF, and @page sets the paper.`;
