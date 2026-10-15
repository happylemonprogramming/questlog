import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { LetterSheet, ResumeSheet, SHEET_H, SHEET_W } from '@/components/Sheet';
import type { LetterData, ResumeData } from './sheet';

/**
 * Render a sheet off-screen and report whether it fits one letter page, so
 * the agent can check its own work instead of asking the user to look.
 */
export async function measureSheet(kind: 'resume' | 'letter', data: unknown): Promise<string> {
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${SHEET_W}px;visibility:hidden;pointer-events:none`;
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(kind === 'resume' ? <ResumeSheet data={data as ResumeData} /> : <LetterSheet data={data as LetterData} />));
    await document.fonts.ready;
    const h = (host.firstElementChild as HTMLElement | null)?.offsetHeight ?? 0;
    if (h <= SHEET_H + 1) return 'It fits on one page.';
    const over = Math.round(((h - SHEET_H) / SHEET_H) * 100);
    return `It is ${over}% too long for one page (${h - SHEET_H}px over). Shorten it and save again.`;
  } catch (e) {
    return `It failed to render: ${e instanceof Error ? e.message : e}. Check the data shape against the base document.`;
  } finally {
    root.unmount();
    host.remove();
  }
}
