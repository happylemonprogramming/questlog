import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { DocSheet } from '@/components/Sheet';
import { fontsReady, pageRules } from '@/lib/design';
import type { ResumeData } from '@/lib/sheet';

/**
 * One sheet, nothing else, then the browser's print dialog. Printing to PDF
 * keeps a real text layer, which applicant tracking systems need; a canvas
 * snapshot would not.
 */
export default function PrintView() {
  const { id = '' } = useParams();
  const doc = useLiveQuery(() => db.docs.get(id), [id]);

  useEffect(() => {
    document.documentElement.classList.remove('dark');
    document.body.style.background = '#fff';
  }, []);

  useEffect(() => {
    if (!doc) return;
    const name = ((doc.data as ResumeData).header?.name || 'Document').replace(/\s+/g, '_');
    document.title = `${name}_${doc.kind === 'letter' ? 'Cover_Letter' : 'Resume'}`;
    // @page only works at document level, so lift the design's paper settings out of its shadow root.
    const page = document.createElement('style');
    page.textContent = pageRules(doc.css);
    document.head.appendChild(page);
    let cancelled = false;
    void fontsReady().then(() => setTimeout(() => !cancelled && window.print(), 300));
    return () => { cancelled = true; page.remove(); };
  }, [doc]);

  if (!doc) return null;
  return (
    <div className="mx-auto w-[8.5in] print:w-auto">
      <p className="py-3 text-center font-sans text-[13px] text-neutral-500 print:hidden">
        In the print dialog choose <b>Save as PDF</b>, paper <b>Letter</b>, margins <b>None</b>, and turn off headers and footers.
      </p>
      <DocSheet doc={doc} />
    </div>
  );
}
