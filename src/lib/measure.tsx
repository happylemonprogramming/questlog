import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { DocSheet, SHEET_H, SHEET_W } from '@/components/Sheet';
import { fontsReady } from './design';
import type { Doc } from './types';

/**
 * Render a sheet off-screen and report whether it fits one letter page, so
 * the agent can check its own work instead of asking the user to look.
 */
export async function measureSheet(doc: Pick<Doc, 'kind' | 'data' | 'css'>): Promise<string> {
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${SHEET_W}px;visibility:hidden;pointer-events:none`;
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(<DocSheet doc={doc} />));
    await fontsReady();
    const frame = host.firstElementChild as HTMLElement | null;
    // A design that fixes the page height hides the overflow instead of growing.
    const page = frame?.shadowRoot?.querySelector('.resume-container');
    const h = Math.max(frame?.offsetHeight ?? 0, page?.scrollHeight ?? 0);
    if (!h) return 'It rendered nothing. Check the data and the design.';
    if (h <= SHEET_H + 1) return 'It fits on one page.';
    const over = Math.round(((h - SHEET_H) / SHEET_H) * 100);
    return `It is ${over}% too long for one page (${h - SHEET_H}px over). Shorten it, or tighten the design, and save again.`;
  } catch (e) {
    return `It failed to render: ${e instanceof Error ? e.message : e}. Check the data against the tool's schema.`;
  } finally {
    root.unmount();
    host.remove();
  }
}
