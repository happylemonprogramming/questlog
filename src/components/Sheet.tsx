import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { LetterData, ResumeData, Section, SheetHeader } from '@/lib/sheet';
import type { Doc } from '@/lib/types';
import { cleanHtml, sheetStyles } from '@/lib/design';
import { parseLinks } from '@/lib/utils';

const ext = { target: '_blank', rel: 'noopener noreferrer' } as const;

/** Stored documents come from people and models; render a lone value or nothing as a list. */
function list<T>(v: T[] | T | undefined | null): T[] {
  return Array.isArray(v) ? v : v == null ? [] : [v];
}

/** Render a stored string, turning `[text](url)` into links. */
export function Rich({ text }: { text: string }) {
  return (
    <>
      {parseLinks(text ?? '').map((p, i) =>
        p.href ? <a key={i} href={p.href} {...ext}>{p.text}</a> : <Fragment key={i}>{p.text}</Fragment>,
      )}
    </>
  );
}

const isDark = () => document.documentElement.classList.contains('dark');

function useDark() {
  const [dark, setDark] = useState(isDark);
  useEffect(() => {
    const mo = new MutationObserver(() => setDark(isDark()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);
  return dark;
}

/**
 * The sheet inside its own shadow root, styled only by the document's design.
 * A design can restyle the page however it likes without touching the app.
 */
function Frame({ children, className, css }: { children: ReactNode; className?: string; css?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<ShadowRoot | null>(null);
  const dark = useDark();
  useLayoutEffect(() => {
    const el = host.current!;
    setRoot(el.shadowRoot ?? el.attachShadow({ mode: 'open' }));
  }, []);
  useLayoutEffect(() => {
    if (root) root.adoptedStyleSheets = sheetStyles(css);
  }, [root, css]);
  return (
    <div ref={host}>
      {root &&
        createPortal(
          <div className={dark ? 'dark' : undefined}>
            <div className={`resume-container ${className ?? ''}`}>
              <span className="crop crop-tl" aria-hidden="true" />
              <span className="crop crop-tr" aria-hidden="true" />
              <span className="crop crop-bl" aria-hidden="true" />
              <span className="crop crop-br" aria-hidden="true" />
              {children}
            </div>
          </div>,
          root,
        )}
    </div>
  );
}

function Header({ h, doc }: { h: SheetHeader; doc: string }) {
  return (
    <header className="sheet-header">
      <div className="header-text">
        {list(h.eyebrow).length ? (
          <p className="eyebrow">
            {list(h.eyebrow).map((r, i) => (
              <Fragment key={i}>
                {i > 0 && <span className="eyebrow-sep">/</span>} {r}{' '}
              </Fragment>
            ))}
          </p>
        ) : null}
        <h1 className="name-title">{h.name}</h1>
        <div className="contact-info">
          {list(h.contact).map((c, i) => (
            <Fragment key={i}>
              {i > 0 && <span className="divider">•</span>}
              {c.href ? <a href={c.href} {...ext}>{c.label}</a> : <span>{c.label}</span>}
            </Fragment>
          ))}
        </div>
      </div>
      <dl className="title-block">
        <div className="tb-cell"><dt>DOC</dt><dd>{doc}</dd></div>
        <div className="tb-cell"><dt>REV</dt><dd>{h.rev}</dd></div>
        <div className="tb-cell"><dt>SHEET</dt><dd>1 OF 1</dd></div>
      </dl>
    </header>
  );
}

function SectionBody({ s }: { s: Section }) {
  switch (s.kind) {
    case 'text':
      return <p className="objective-text"><Rich text={s.text} /></p>;
    case 'skills':
      return (
        <>
          {list(s.rows).map((r) => (
            <div className="skills-row" key={r.label}>
              <span className="skills-label">{r.label}</span>
              <div className="skills-badges">
                {list(r.items).map((it) => <span className="skill-badge" key={it}>{it}</span>)}
              </div>
            </div>
          ))}
        </>
      );
    case 'experience':
      return (
        <>
          {list(s.companies).map((c, ci) => (
            <Fragment key={ci}>
              <div className="company-header"><p className="company-info"><Rich text={c.line} /></p></div>
              {list(c.roles).map((r, ri) => (
                <div className="job-item" key={ri}>
                  <div className="job-header">
                    <h3 className="job-title">
                      <Rich text={r.title} />
                      {r.active && <span className="active-badge">ACTIVE</span>}
                    </h3>
                    <span className="job-date">{r.dates}</span>
                  </div>
                  <ul className="job-duties">
                    {list(r.bullets).map((b, bi) => <li key={bi}><Rich text={b} /></li>)}
                  </ul>
                </div>
              ))}
            </Fragment>
          ))}
        </>
      );
    case 'projects':
      return (
        <div className="projects-grid">
          {list(s.cards).map((c) => (
            <div className="project-card" key={c.title}>
              <div className="project-card-header">
                <h3 className="project-card-title">{c.title}</h3>
                {c.date && <span className="project-card-date">{c.date}</span>}
                {list(c.links).map((l) => (
                  <a key={l.label} href={l.href} className="project-card-link" {...ext}>{l.label}</a>
                ))}
              </div>
              {c.award && <p className="project-card-award">{c.award}</p>}
              <p className="project-card-desc"><Rich text={c.desc} /></p>
              {c.stack && <p className="project-card-stack">{c.stack}</p>}
            </div>
          ))}
        </div>
      );
    case 'education':
      return (
        <>
          {list(s.items).map((e, i) => (
            <div className="education-item" key={i}>
              <div className="education-header">
                <h3 className="degree-title">
                  {e.degree}
                  {e.school && <span className="school-name"> • {e.school}</span>}
                </h3>
                <span className="grad-date">{e.date}</span>
              </div>
            </div>
          ))}
        </>
      );
    case 'html':
      return <HtmlBlock html={s.html} />;
  }
}

function HtmlBlock({ html }: { html: string }) {
  const clean = useMemo(() => cleanHtml(html ?? ''), [html]);
  return <div className="html-block" dangerouslySetInnerHTML={{ __html: clean }} />;
}

export function ResumeSheet({ data, css }: { data: ResumeData; css?: string }) {
  let n = 0;
  const sections = list(data.sections).map((s, i) => (
    <section key={i} className={s.class ? `resume-section ${s.class}` : 'resume-section'} data-kind={s.kind}>
      {s.title ? (
        <h2 className="section-title">
          <span className="balloon" aria-hidden="true">{++n}</span>
          {s.title}
        </h2>
      ) : null}
      <SectionBody s={s} />
    </section>
  ));
  // Columns appear in the order their first section does.
  const columns = new Map<string, ReactNode[]>();
  if (list(data.sections).some((s) => s.column)) {
    list(data.sections).forEach((s, i) => {
      const c = s.column || 'main';
      columns.set(c, [...(columns.get(c) ?? []), sections[i]]);
    });
  }
  return (
    <Frame css={css}>
      {data.keywords && (
        <div className="ats-keywords" aria-hidden="true"><span>{data.keywords}</span></div>
      )}
      <Header h={data.header ?? EMPTY_HEADER} doc="RESUME" />
      {columns.size
        ? [...columns].map(([c, nodes]) => <div key={c} className="sheet-column" data-column={c}>{nodes}</div>)
        : sections}
      {list(data.footer?.items).length ? (
        <footer className="sheet-notes">
          <span className="notes-label">{data.footer?.label}</span>
          <ol>{list(data.footer?.items).map((it, i) => <li key={i}><Rich text={it} /></li>)}</ol>
        </footer>
      ) : null}
    </Frame>
  );
}

export function LetterSheet({ data, css }: { data: LetterData; css?: string }) {
  return (
    <Frame className="letter-sheet" css={css}>
      <Header h={data.header ?? EMPTY_HEADER} doc="LETTER" />
      <dl className="transmittal">
        <div className="tx-cell"><dt>DATE</dt><dd>{data.date}</dd></div>
        <div className="tx-cell tx-to">
          <dt>TO</dt>
          <dd>
            {data.to?.name}
            <span className="tx-sub"> • {data.to?.company}{data.to?.location ? ` • ${data.to.location}` : ''}</span>
          </dd>
        </div>
        <div className="tx-cell tx-re">
          <dt>RE</dt>
          <dd>{data.re}{data.reference ? <span className="tx-sub"> • {data.reference}</span> : null}</dd>
        </div>
      </dl>
      <article className="letter-body">
        <p className="letter-salutation">{data.salutation}</p>
        <p><Rich text={data.opening} /></p>
        {list(data.points).length ? (
          <ol className="letter-points">
            {list(data.points).map(({ lead, text }, i) => (
              <li key={i}>
                <span className="balloon" aria-hidden="true">{i + 1}</span>
                <p><strong>{lead}.</strong> <Rich text={text} /></p>
              </li>
            ))}
          </ol>
        ) : null}
        {list(data.body).map((p, i) => <p key={i}><Rich text={p} /></p>)}
        <p><Rich text={data.closing} /></p>
        <div className="letter-signoff">
          <p>{data.signoff}</p>
          <p className="signature">{data.header?.name}</p>
        </div>
      </article>
      {list(data.enclosure).length ? (
        <footer className="sheet-notes">
          <span className="notes-label">ENCLOSURE</span>
          <ol>{list(data.enclosure).map((e, i) => <li key={i}>{e}</li>)}</ol>
        </footer>
      ) : null}
    </Frame>
  );
}

/** A resume or letter in its design. `css` overrides the saved design, for live previews. */
export function DocSheet({ doc, css = doc.css }: { doc: Pick<Doc, 'kind' | 'data' | 'css'>; css?: string }) {
  return doc.kind === 'letter' ? <LetterSheet data={doc.data as LetterData} css={css} /> : <ResumeSheet data={doc.data as ResumeData} css={css} />;
}

const EMPTY_HEADER: SheetHeader = { eyebrow: [], name: '', contact: [], rev: '' };

/** Letter paper at 96 dpi. */
export const SHEET_W = 816;
export const SHEET_H = 1056;

/**
 * A sheet scaled to fit its box. Reports whether the content spills past one
 * page, which is the one layout rule a resume must never break.
 */
export function ScaledSheet({ children, width, onFit }: { children: ReactNode; width: number; onFit?: (fits: boolean, height: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(SHEET_H);
  const scale = width / SHEET_W;
  const onFitRef = useRef(onFit);
  onFitRef.current = onFit;

  // The observer fires whenever the sheet's size changes, including after content edits.
  useLayoutEffect(() => {
    const el = ref.current?.firstElementChild as HTMLElement | null;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const height = el.offsetHeight;
      setH(height);
      onFitRef.current?.(height <= SHEET_H + 1, height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div style={{ width, height: h * scale }} className="relative overflow-hidden">
      <div ref={ref} style={{ width: SHEET_W, transform: `scale(${scale})`, transformOrigin: 'top left' }} className="absolute left-0 top-0">
        {children}
      </div>
    </div>
  );
}
