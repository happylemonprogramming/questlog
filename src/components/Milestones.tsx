import { useEffect, useRef, useState } from 'react';
import { roman, useJourney } from '@/lib/quest';
import { useDisk } from '@/lib/disk';
import { isDesktop } from '@/lib/desktop';

const SEEN_KEY = 'questlog:seen-chapter';
const XP_NOTE_MAX = 400;

export interface Gain {
  xp: number;
  text: string;
  key: number;
}

// Points just earned, for the HUD to float up beside the experience bar.
let gain: Gain | null = null;
const listeners = new Set<() => void>();
function publish(g: Gain | null) {
  gain = g;
  listeners.forEach((l) => l());
}

/** The points just earned, for about a second and a half, then nothing. */
export function useXpGain(): Gain | null {
  const [g, setG] = useState(gain);
  useEffect(() => {
    const l = () => setG(gain);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return g;
}

/**
 * Small moments as the story moves: points floating into the HUD when a deed
 * earns them, a gold flash along the top when something is turned in, and a
 * chapter title when a new chapter begins, the way a game names a region as
 * you walk into it. Quiet on purpose; the first look at the app sets the
 * baseline instead of announcing everything at once.
 */
export function Milestones() {
  const journey = useJourney();
  const { ready } = useDisk();
  // In the desktop app, wait until the folder has been read in.
  const j = !isDesktop() || ready ? journey : undefined;
  const base = useRef<number | null>(null);
  const [flash, setFlash] = useState(0);
  const [chapter, setChapter] = useState<{ level: number; title: string } | null>(null);

  useEffect(() => {
    if (!j) return;
    const xp = j.level.xp;
    if (base.current === null) {
      base.current = xp;
      if (!localStorage.getItem(SEEN_KEY)) localStorage.setItem(SEEN_KEY, String(j.level.level));
      return;
    }
    // A jump this size is an import or a restore, not something just done.
    if (xp > base.current && xp - base.current <= XP_NOTE_MAX) {
      const text = j.deeds[0]?.text ?? '';
      publish({ xp: xp - base.current, text, key: Date.now() });
      if (/^Turned in /.test(text)) setFlash(Date.now());
      const seen = Number(localStorage.getItem(SEEN_KEY)) || 1;
      if (j.level.level > seen) {
        localStorage.setItem(SEEN_KEY, String(j.level.level));
        setTimeout(() => setChapter({ level: j.level.level, title: j.level.title }), 900);
      }
    } else if (xp > base.current) {
      localStorage.setItem(SEEN_KEY, String(j.level.level));
    }
    base.current = xp;
  }, [j]);

  const g = useXpGain();
  useEffect(() => {
    if (!g) return;
    const t = setTimeout(() => publish(null), 1700);
    return () => clearTimeout(t);
  }, [g]);

  useEffect(() => {
    if (!chapter) return;
    const t = setTimeout(() => setChapter(null), 4600);
    return () => clearTimeout(t);
  }, [chapter]);

  return (
    <>
      {flash > 0 && <div key={flash} className="flash-bar" aria-hidden="true" />}
      {chapter && (
        <button
          onClick={() => setChapter(null)}
          className="page-enter fixed inset-0 z-[95] grid place-items-center bg-[radial-gradient(ellipse_at_center,hsl(var(--background)/0.55),hsl(var(--sunken)/0.92))]"
          aria-label="Close"
        >
          <div className="text-center">
            <p className="reveal font-mono text-[11.5px] uppercase text-muted-foreground" style={{ animationDelay: '0.1s' }}>Chapter {roman(chapter.level)}</p>
            <p className="reveal mt-4 font-display text-[52px] leading-none sm:text-[72px]" style={{ animationDelay: '0.3s' }}>
              The {chapter.title}
            </p>
            <div className="mx-auto mt-7 flex items-center justify-center gap-3 text-gold">
              <span className="h-px w-32 origin-right bg-gradient-to-l from-gold to-transparent animate-in zoom-in-0 duration-1000" />
              <span className="text-[10px]">◆</span>
              <span className="h-px w-32 origin-left bg-gradient-to-r from-gold to-transparent animate-in zoom-in-0 duration-1000" />
            </div>
          </div>
        </button>
      )}
    </>
  );
}
