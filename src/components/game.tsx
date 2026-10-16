import type { CSSProperties, ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The pieces of the game's face: hearts, the stamina ring, the experience
 * bar, objectives, rewards and the companion's speech box. Each is small and
 * draws only from the data it's given, so screens can compose them freely.
 */

function Heart({ full, half, size }: { full: boolean; half?: boolean; size: number }) {
  return (
    <svg viewBox="0 0 24 22" width={size} height={size * (22 / 24)} aria-hidden="true" className="shrink-0 transition-transform duration-500 ease-spring">
      <defs>
        <clipPath id="heart-half"><rect x="0" y="0" width="12" height="22" /></clipPath>
      </defs>
      <path
        d="M12 20.5C7 16 1.5 12 1.5 6.9 1.5 3.9 3.9 1.5 6.9 1.5c2 0 3.9 1.1 5.1 2.9 1.2-1.8 3.1-2.9 5.1-2.9 3 0 5.4 2.4 5.4 5.4 0 5.1-5.5 9.1-10.5 13.6z"
        fill={full ? 'hsl(var(--heart))' : 'hsl(var(--frame) / 0.14)'}
        stroke={full ? 'hsl(var(--heart))' : 'hsl(var(--frame) / 0.5)'}
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      {half && !full && (
        <path
          d="M12 20.5C7 16 1.5 12 1.5 6.9 1.5 3.9 3.9 1.5 6.9 1.5c2 0 3.9 1.1 5.1 2.9 1.2-1.8 3.1-2.9 5.1-2.9 3 0 5.4 2.4 5.4 5.4 0 5.1-5.5 9.1-10.5 13.6z"
          fill="hsl(var(--heart))"
          clipPath="url(#heart-half)"
        />
      )}
      {full && <path d="M6.5 5.2c.9-.9 2-1.2 3-1" fill="none" stroke="hsl(0 0% 100% / 0.55)" strokeWidth="1.2" strokeLinecap="round" />}
    </svg>
  );
}

/** Today's goal as hearts: each application sent fills one. They only ever fill. */
export function Hearts({ filled, total, size = 16, className, onClick, title }: { filled: number; total: number; size?: number; className?: string; onClick?: () => void; title?: string }) {
  const hearts = Array.from({ length: total }, (_, i) => <Heart key={i} full={i < filled} size={size} />);
  const cls = cn('flex items-center gap-[3px]', className);
  if (onClick) {
    return (
      <button onClick={onClick} title={title} className={cn(cls, 'rounded-md px-1 py-0.5 transition hover:bg-accent/60')} aria-label={title}>
        {hearts}
      </button>
    );
  }
  return <span className={cls} title={title} aria-label={title}>{hearts}</span>;
}

/** The week's effort as a ring that fills clockwise, the way stamina does. */
export function Ring({ value, max, size = 30, stroke = 3.5, className, children, title }: { value: number; max: number; size?: number; stroke?: number; className?: string; children?: ReactNode; title?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const k = Math.min(1, max ? value / max : 0);
  return (
    <span className={cn('relative inline-grid place-items-center', className)} style={{ width: size, height: size }} title={title} aria-label={title}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--frame) / 0.18)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={k >= 1 ? 'hsl(var(--success))' : 'hsl(var(--gold))'}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - k)}
          style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.2,0.8,0.2,1)', filter: k > 0 ? 'drop-shadow(0 0 3px hsl(var(--gold) / 0.6))' : undefined }}
        />
      </svg>
      {children && <span className="absolute inset-0 grid place-items-center">{children}</span>}
    </span>
  );
}

/** Points toward the next chapter, as a bar. */
export function XpBar({ into, span, surge, className }: { into: number; span: number; surge?: boolean; className?: string }) {
  return (
    <div className={cn('xp-track', className)}>
      <div className={cn('xp-fill', surge && 'xp-surge')} style={{ width: `${Math.min(100, (into / span) * 100)}%` }} />
    </div>
  );
}

/** A quest's step: a diamond that fills when it's done, lit when it's the one to do now. */
export function Objective({ done, current, title, detail, children, className }: { done: boolean; current?: boolean; title: ReactNode; detail?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <li className={cn('flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-md px-3 py-2.5 transition-colors duration-300 sm:px-3.5', current && 'bg-gold-soft/50 ring-1 ring-gold/40', className)}>
      <span className="relative grid size-6 shrink-0 place-items-center">
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" className={cn(current && 'drop-shadow-[0_0_5px_hsl(var(--gold))]')}>
          <path d="M8 1.5L14.5 8 8 14.5 1.5 8z" fill={done ? 'hsl(var(--gold))' : current ? 'hsl(var(--gold) / 0.25)' : 'none'} stroke={done || current ? 'hsl(var(--gold))' : 'hsl(var(--frame) / 0.5)'} strokeWidth="1.5" />
        </svg>
        {done && <Check className="absolute size-3 text-gold-foreground" strokeWidth={3.5} />}
      </span>
      <div className="min-w-[10rem] flex-1">
        <p className={cn('text-[14.5px] font-medium', done && 'text-muted-foreground line-through decoration-muted-foreground/40')}>{title}</p>
        {detail && <p className="text-[12.5px] text-muted-foreground">{detail}</p>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2 max-sm:ml-9">{children}</div>}
    </li>
  );
}

/** Points on offer or earned, as a small plate. */
export function Reward({ xp, label = 'Reward', className }: { xp: number; label?: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-md border border-gold/45 bg-gold-soft/40 px-2 py-0.5 text-[12px] text-gold-ink', className)}>
      <span className="font-display text-[12.5px] tracking-wide">{label}</span>
      <span className="font-mono font-semibold">+{xp}</span>
    </span>
  );
}

/** The companion's dialog box, a name plate at its shoulder. */
export function Speech({ who = 'Guide', children, className, style, more, compact }: { who?: string; children: ReactNode; className?: string; style?: CSSProperties; more?: boolean; compact?: boolean }) {
  return (
    <div className={cn('speech', compact ? 'px-4 pb-3 pt-4' : 'px-5 pb-4 pt-5 sm:px-6', className)} style={style}>
      <span className="speech-plate">{who}</span>
      <div className="text-[14.5px] leading-relaxed [&_a]:underline [&_a]:decoration-gold/60 [&_a]:underline-offset-2 [&_p+p]:mt-2 [&_strong]:text-[hsl(40_72%_72%)]">{children}</div>
      {more && <span className="speech-cursor absolute bottom-2.5 right-3.5" aria-hidden="true" />}
    </div>
  );
}

/** A small plate: a label in display type, for sections inside a panel. */
export function Plate({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('font-display inline-flex h-6 items-center rounded-[4px] border border-frame/30 bg-sunken/70 px-2 text-[13px] tracking-wide text-muted-foreground', className)}>{children}</span>;
}

/** A campfire, for resting. Flickers a little. */
export function Campfire({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path d="M10 40l28-6M10 34l28 6" stroke="hsl(var(--gold-ink))" strokeWidth="3" strokeLinecap="round" opacity=".8" />
      <g style={{ transformOrigin: '24px 36px', animation: 'flicker 1.6s ease-in-out infinite' }}>
        <path d="M24 8c2 6 8 8 8 16a8 8 0 01-16 0c0-4 2-6 3-8 0 3 1 4 2 4 0-5 1-9 3-12z" fill="hsl(var(--gold))" />
        <path d="M24 18c1 3 4 4 4 8a4 4 0 01-8 0c0-2 1-3 2-4 0 1.5.5 2 1 2 0-2.5.3-4.5 1-6z" fill="hsl(40 90% 70%)" />
      </g>
    </svg>
  );
}
