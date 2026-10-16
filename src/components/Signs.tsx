import type { ComponentType } from 'react';
import { AlertTriangle, Coins, Rocket, ScrollText, ShieldAlert, ShieldCheck, ShieldHalf, Sprout, Tent } from 'lucide-react';
import { payFilterName, SIGN_NAME, SIGN_NONE, SIGNS, signsOf, useSignContext, type Sign, type SignId, type SignTone } from '@/lib/signs';
import type { Job } from '@/lib/types';
import { cn } from '@/lib/utils';

type Icon = ComponentType<{ className?: string }>;

const ICON: Record<SignId, Icon> = {
  remote: Tent,
  pay: Coins,
  fit: ShieldCheck,
  flags: AlertTriangle,
  moonshot: Rocket,
  ready: ScrollText,
  fresh: Sprout,
};

function iconFor(s: Sign): Icon {
  if (s.id === 'fit') return s.level === 'good' ? ShieldCheck : s.level === 'mixed' ? ShieldHalf : ShieldAlert;
  return ICON[s.id];
}

const TONE: Record<SignTone, string> = {
  info: 'bg-info/12 text-info ring-info/30',
  gold: 'bg-gold-soft text-gold-ink ring-gold/50',
  success: 'bg-success/12 text-success ring-success/30',
  warning: 'bg-warning/12 text-warning ring-warning/30',
  danger: 'bg-danger/12 text-danger ring-danger/30',
  violet: 'bg-violet/12 text-violet ring-violet/30',
};

const title = (s: Sign) => (s.detail ? `${s.label} · ${s.detail}` : s.label);

/**
 * A quest's signs. By default only the ones it has, as glyphs. `sockets`
 * draws every slot in a fixed order, empty ones faint, so a column of rows
 * lines up and reads at a glance. `labels` writes each one out, for a sheet.
 */
export function Signs({ job, sockets, labels, className }: { job: Job; sockets?: boolean; labels?: boolean; className?: string }) {
  const ctx = useSignContext();
  const signs = signsOf(job, ctx);
  const ids = sockets ? SIGNS : SIGNS.filter((id) => signs[id]);
  if (!ids.length) return null;
  return (
    <div className={cn('flex items-center', labels ? 'flex-wrap gap-1.5' : 'gap-[3px]', className)} aria-label="Signs">
      {ids.map((id) => {
        const s = signs[id];
        if (!s) {
          return <span key={id} title={SIGN_NONE[id]} className="size-[18px] shrink-0 rounded-[4px] ring-1 ring-inset ring-frame/20" />;
        }
        const I = iconFor(s);
        return labels ? (
          <span key={id} title={s.detail} className={cn('inline-flex h-6 items-center gap-1.5 rounded-[4px] px-2 text-[12px] font-medium ring-1 ring-inset [&_svg]:size-3.5', TONE[s.tone])}>
            <I />
            {s.label}
          </span>
        ) : (
          <span key={id} title={title(s)} className={cn('grid size-[18px] shrink-0 place-items-center rounded-[4px] ring-1 ring-inset [&_svg]:size-3', TONE[s.tone])}>
            <I />
          </span>
        );
      })}
    </div>
  );
}

/**
 * Filters by sign. Any number can be on at once, and a quest must carry all
 * of them. Each chip is also the legend for its glyph.
 */
export function SignChips({ value, onChange, counts, className }: { value: ReadonlySet<SignId>; onChange: (v: Set<SignId>) => void; counts: Partial<Record<SignId, number>>; className?: string }) {
  const ctx = useSignContext();
  const toggle = (id: SignId) => {
    const next = new Set(value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };
  return (
    <div className={cn('scroll-none flex gap-1 overflow-x-auto', className)} role="group" aria-label="Filter by sign">
      {SIGNS.map((id) => {
        const on = value.has(id);
        const I = ICON[id];
        const n = counts[id] ?? 0;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(id)}
            disabled={!on && n === 0}
            className={cn(
              'flex h-8 shrink-0 items-center gap-1.5 rounded-[5px] px-2.5 text-[13px] font-medium ring-1 ring-inset transition-colors duration-200 [&_svg]:size-3.5',
              on ? 'bg-gold-soft/70 text-foreground ring-gold/60 [&_svg]:text-gold-ink' : 'text-muted-foreground ring-frame/20 hover:text-foreground hover:ring-frame/40 disabled:opacity-40 disabled:hover:text-muted-foreground disabled:hover:ring-frame/20',
            )}
          >
            <I />
            {id === 'pay' ? payFilterName(ctx) : SIGN_NAME[id]}
            <span className="font-mono text-[11px] tabular-nums opacity-60">{n}</span>
          </button>
        );
      })}
    </div>
  );
}
