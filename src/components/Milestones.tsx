import { useEffect, useRef, useState } from 'react';
import { useJourney } from '@/lib/quest';
import { useDisk } from '@/lib/disk';
import { isDesktop } from '@/lib/desktop';

const SEEN_KEY = 'questlog:seen-chapter';
const XP_NOTE_MAX = 400;

/**
 * Small moments as the story moves: a note with the points a deed earned, and
 * a chapter card when a new chapter begins. Quiet on purpose; the first look
 * at the app sets the baseline instead of announcing everything at once.
 */
export function Milestones() {
  const journey = useJourney();
  const { ready } = useDisk();
  // In the desktop app, wait until the folder has been read in.
  const j = !isDesktop() || ready ? journey : undefined;
  const base = useRef<number | null>(null);
  const [note, setNote] = useState<{ xp: number; text: string; key: number } | null>(null);
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
      setNote({ xp: xp - base.current, text: j.deeds[0]?.text ?? '', key: Date.now() });
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

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 3200);
    return () => clearTimeout(t);
  }, [note]);

  useEffect(() => {
    if (!chapter) return;
    const t = setTimeout(() => setChapter(null), 4200);
    return () => clearTimeout(t);
  }, [chapter]);

  return (
    <>
      {note && (
        <div key={note.key} role="status" className="pop pointer-events-none fixed bottom-24 left-1/2 z-[90] flex max-w-[90vw] -translate-x-1/2 items-center gap-3 rounded-full border border-gold/40 bg-surface/95 py-2 pl-3 pr-5 shadow-lift backdrop-blur">
          <span className="grid size-6 rotate-45 place-items-center rounded-[5px] bg-gold"><span className="size-1.5 rounded-full bg-gold-foreground" /></span>
          <span className="font-mono text-[13px] font-semibold text-gold-ink">+{note.xp}</span>
          <span className="truncate text-[13px] text-muted-foreground">{note.text}</span>
        </div>
      )}
      {chapter && (
        <button
          onClick={() => setChapter(null)}
          className="page-enter fixed inset-0 z-[95] grid place-items-center bg-background/70 backdrop-blur-sm"
          aria-label="Close"
        >
          <div className="text-center">
            <p className="eyebrow-label">A new chapter</p>
            <p className="mt-3 font-display text-[44px] font-normal leading-tight tracking-[-0.01em] sm:text-[60px]">
              Chapter {chapter.level}
            </p>
            <p className="mt-1 font-display text-[22px] italic text-gold-ink sm:text-[26px]">The {chapter.title}</p>
            <div className="mx-auto mt-6 h-px w-40 bg-gradient-to-r from-transparent via-gold to-transparent" />
          </div>
        </button>
      )}
    </>
  );
}
