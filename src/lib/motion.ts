import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A number that counts up to its value: from zero on first show, then from the
 * old value when it changes. One requestAnimationFrame loop, about half a second.
 */
export function useCountUp(value: number, ms = 650) {
  const [shown, setShown] = useState(() => (reducedMotion() ? value : 0));
  const from = useRef(shown);
  useEffect(() => {
    if (reducedMotion()) {
      setShown(value);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let frame = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const v = Math.round(a + (value - a) * (1 - (1 - k) ** 3));
      from.current = v;
      setShown(v);
      if (k < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, ms]);
  return shown;
}

/**
 * Keeps an absolutely positioned highlight under the selected item of a row or
 * list, sliding it when the selection changes. Pass the selector of the
 * selected item, e.g. `[aria-pressed="true"]`.
 */
export function useSlidingHighlight<C extends HTMLElement, H extends HTMLElement>(selected: string, key: unknown) {
  const container = useRef<C>(null);
  const highlight = useRef<H>(null);
  useLayoutEffect(() => {
    const place = () => {
      const el = container.current?.querySelector<HTMLElement>(selected);
      const h = highlight.current;
      if (!h) return;
      if (!el) {
        h.style.opacity = '0';
        return;
      }
      const first = h.style.opacity !== '1';
      h.style.transition = first ? 'none' : '';
      h.style.transform = `translate(${el.offsetLeft}px, ${el.offsetTop}px)`;
      h.style.width = `${el.offsetWidth}px`;
      h.style.height = `${el.offsetHeight}px`;
      h.style.opacity = '1';
      // In a scrolling row, bring the selection into view.
      const c = container.current!;
      if (c.scrollWidth > c.clientWidth && (el.offsetLeft < c.scrollLeft || el.offsetLeft + el.offsetWidth > c.scrollLeft + c.clientWidth)) {
        c.scrollTo({ left: el.offsetLeft - (c.clientWidth - el.offsetWidth) / 2, behavior: first ? 'auto' : 'smooth' });
      }
    };
    place();
    const ro = new ResizeObserver(place);
    if (container.current) ro.observe(container.current);
    return () => ro.disconnect();
  }, [selected, key]);
  return { container, highlight };
}
