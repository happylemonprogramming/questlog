import { useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, MapPin, Rocket, Wallet } from 'lucide-react';
import { Badge, type Tone } from '@/components/ui/badge';
import { SHOWN_STAGES, STAGE_HINT, STAGE_LABEL, type Job, type Stage } from '@/lib/types';
import { useSlidingHighlight } from '@/lib/motion';
import { cn, hueFor } from '@/lib/utils';
import { companyDomain, logoUrl, missingLogos, useLogos } from '@/lib/logo';
import { QuickActions, QuickPills } from '@/components/QuickActions';

type MarkJob = Pick<Job, 'company' | 'website' | 'url' | 'portal'>;

/** The company's logo, or its initials while the logo loads and when there isn't one. */
export function CompanyMark({ job, size = 36, className }: { job: MarkJob; size?: number; className?: string }) {
  const name = job.company;
  const hue = hueFor(name || '?');
  const letters = (name || '?').replace(/\(.*?\)/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const logos = useLogos();
  const domain = logos ? companyDomain(job) : undefined;
  const [shown, setShown] = useState<string>();
  const want = domain && !missingLogos.has(domain) ? domain : undefined;
  return (
    <div
      className={cn('sepia-art relative grid shrink-0 place-items-center overflow-hidden rounded-md font-semibold tracking-tight', className)}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `hsl(${hue} 70% 50% / 0.13)`,
        color: `hsl(${hue} 55% 42%)`,
        boxShadow: `inset 0 0 0 1px hsl(${hue} 60% 50% / 0.18)`,
      }}
      aria-hidden="true"
    >
      <span className="dark:brightness-150">{letters}</span>
      {want && (
        <span className={cn('sepia-art absolute inset-0 grid place-items-center bg-white ring-1 ring-inset ring-black/5 transition-opacity duration-300', shown === want ? 'opacity-100' : 'opacity-0')}>
          <img
            key={want}
            src={logoUrl(want)}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className="size-[68%] object-contain"
            onLoad={(e) => {
              // A missing favicon comes back as a tiny generic globe.
              if (e.currentTarget.naturalWidth < 32) missingLogos.add(want);
              else setShown(want);
            }}
            onError={() => missingLogos.add(want)}
          />
        </span>
      )}
    </div>
  );
}

export const STAGE_TONE: Record<Stage, Tone> = {
  inbox: 'neutral',
  saved: 'outline',
  next: 'gold',
  applied: 'info',
  interviewing: 'violet',
  offer: 'success',
  closed: 'neutral',
};

export const STAGE_DOT: Record<Stage, string> = {
  inbox: 'bg-muted-foreground/40',
  saved: 'bg-muted-foreground',
  next: 'bg-gold',
  applied: 'bg-info',
  interviewing: 'bg-violet',
  offer: 'bg-success',
  closed: 'bg-muted-foreground/30',
};

/** The CSS color variable for each stage, for glows and tints. */
export const STAGE_VAR: Record<Stage, string> = {
  inbox: '--muted-foreground',
  saved: '--muted-foreground',
  next: '--gold',
  applied: '--info',
  interviewing: '--violet',
  offer: '--success',
  closed: '--muted-foreground',
};

/**
 * A quest marker for each stage, the way a map marks its places: a hollow
 * diamond for something only seen, a filled one once it's yours, gold when
 * it's next, a star for an offer.
 */
export function StageMark({ stage, size = 14, className }: { stage: Stage; size?: number; className?: string }) {
  const c = `hsl(var(${STAGE_VAR[stage]}))`;
  const hollow = stage === 'inbox' || stage === 'saved' || stage === 'closed';
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} className={cn('shrink-0', className)} aria-hidden="true">
      {stage === 'offer' ? (
        <path d="M8 1.2l1.9 4.3 4.6.5-3.4 3.1 1 4.6L8 11.4l-4.1 2.3 1-4.6L1.5 6l4.6-.5z" fill={c} />
      ) : (
        <path
          d="M8 1.5L14.5 8 8 14.5 1.5 8z"
          fill={hollow ? 'none' : c}
          stroke={c}
          strokeWidth={stage === 'inbox' || stage === 'closed' ? 1.2 : 1.6}
          strokeDasharray={stage === 'inbox' ? '2 1.5' : undefined}
          opacity={stage === 'closed' ? 0.55 : 1}
        />
      )}
      {stage === 'next' && <circle cx="8" cy="8" r="1.7" fill="hsl(var(--gold-foreground))" />}
      {stage === 'applied' && <path d="M5.2 8.2l2 2 3.8-4" fill="none" stroke="hsl(var(--background))" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />}
      {stage === 'interviewing' && <circle cx="8" cy="8" r="2" fill="hsl(var(--background))" />}
      {stage === 'closed' && <path d="M6 6l4 4M10 6l-4 4" stroke={c} strokeWidth="1.2" strokeLinecap="round" opacity=".7" />}
    </svg>
  );
}

export function StageBadge({ stage }: { stage: Stage }) {
  return (
    <Badge tone={STAGE_TONE[stage]}>
      <StageMark stage={stage} size={11} />
      {STAGE_LABEL[stage]}
    </Badge>
  );
}

/** A screen's title: the name in display type over an ornamented rule. */
export function PageHeader({ eyebrow, title, children, sub, compact }: { eyebrow?: string; title: string; sub?: ReactNode; children?: ReactNode; compact?: boolean }) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-4', compact ? 'mb-5' : 'mb-7')}>
      <div className="min-w-0 flex-1">
        {eyebrow && <p className="eyebrow-label mb-2">{eyebrow}</p>}
        <h1 className={cn('font-display leading-[1.05]', compact ? 'text-[28px]' : 'text-[32px] md:text-[40px]')}>{title}</h1>
        <div className="rule rule-left mt-2 max-w-[420px] text-[10px]">◆</div>
        {sub && <p className="mt-2.5 max-w-[640px] text-[14.5px] text-muted-foreground">{sub}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-frame/40 px-6 py-14 text-center">
      <div className="mb-4 grid size-12 rotate-45 place-items-center rounded-md border border-gold/50 bg-gold-soft/40 text-gold-ink [&_svg]:size-5 [&_svg]:-rotate-45">{icon}</div>
      <p className="font-display text-[21px]">{title}</p>
      {children && <div className="mt-1 max-w-sm text-[13.5px] text-muted-foreground">{children}</div>}
    </div>
  );
}

/**
 * One quest as a row: the shape used by every list in the app. The whole
 * row opens the quest; the quick actions on the right move it along
 * without opening it. With `selected`, the row is the one the cursor is on.
 */
export function JobRow({ job, rank, right, compact, index, actions = true, selected, onPick }: { job: Job; rank?: ReactNode; right?: ReactNode; compact?: boolean; index?: number; actions?: boolean; selected?: boolean; onPick?: () => void }) {
  return (
    <div
      className={cn(
        'cursor group relative flex items-center gap-3 rounded-md px-3 py-2.5 transition-colors duration-200 max-sm:items-start',
        selected ? 'bg-gold-soft/45' : 'hover:bg-accent/60',
        index !== undefined && 'rise',
      )}
      data-selected={selected || undefined}
      style={index !== undefined ? ({ '--i': index } as CSSProperties) : undefined}
    >
      {rank}
      <StageMark stage={job.stage} size={12} className="max-sm:hidden" />
      <CompanyMark job={job} size={compact ? 30 : 36} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link
            to={`/jobs/${encodeURIComponent(job.id)}`}
            onClick={(e) => {
              if (!onPick) return;
              e.preventDefault();
              onPick();
            }}
            className="truncate text-[14.5px] font-medium leading-5 tracking-[-0.005em] outline-none after:absolute after:inset-0 after:rounded-md"
          >
            {job.title}
          </Link>
          {job.moonshot && <Rocket className="size-3.5 shrink-0 text-violet" aria-label="Long shot" />}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-x-3 text-[12.5px] text-muted-foreground">
          <span className="truncate font-medium text-foreground/75">{job.company}</span>
          {job.location && !compact && (
            <span className="hidden min-w-0 items-center gap-1 sm:flex">
              <MapPin className="size-3 shrink-0" />
              <span className="truncate">{job.location}</span>
            </span>
          )}
          {job.pay && !/^not listed/i.test(job.pay) && !compact && (
            <span className="hidden shrink-0 items-center gap-1 whitespace-nowrap font-mono text-[11.5px] md:flex">
              <Wallet className="size-3" />
              {shortPay(job.pay)}
            </span>
          )}
        </div>
        {actions && !compact && <QuickPills job={job} className="relative z-[1] mt-2.5 sm:hidden" />}
      </div>
      {!compact && job.flags?.length ? (
        <Badge tone="warning" className="hidden lg:inline-flex" title={job.flags.join('\n')}>
          <AlertTriangle />
          {job.flags.length === 1 ? job.flags[0] : `${job.flags.length} flags`}
        </Badge>
      ) : null}
      {actions && (
        <QuickActions
          job={job}
          className={cn('relative z-[1] opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100', !compact && 'max-sm:hidden')}
        />
      )}
      {right ?? <span className={cn(actions && !compact && 'max-sm:hidden')}><StageBadge stage={job.stage} /></span>}
    </div>
  );
}

export function shortPay(pay: string) {
  const p = pay.replace(/\s*\(.*\)$/, '');
  return p.length > 26 ? `${p.slice(0, 25)}…` : p;
}

/** A framed panel: an ink line, a gap, and a fainter line outside. `hero` adds gold corners. */
export function Panel({ className, children, style, hero }: { className?: string; children: ReactNode; style?: CSSProperties; hero?: boolean }) {
  return <div className={cn('panel', hero && 'panel-hero', className)} style={style}>{children}</div>;
}
export const Card = Panel;

export function PanelHeader({ title, icon, action, count, className }: { title: string; icon?: ReactNode; action?: ReactNode; count?: number; className?: string }) {
  return (
    <div className={cn('flex items-center gap-3 px-5 pb-2 pt-4', className)}>
      <div className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:text-gold">
        {icon}
        <h2 className="font-display text-[20px] leading-none">{title}</h2>
        {count !== undefined && <span className="font-mono text-[11.5px] text-muted-foreground">{count}</span>}
      </div>
      <span className="h-px min-w-4 flex-1 bg-gradient-to-r from-frame/35 to-transparent" />
      {action}
    </div>
  );
}
export const CardHeader = PanelHeader;

export type StageFilter = Stage | 'all';

/** "All" plus each stage, with counts. The highlight slides to the one you pick. */
export function StageChips({ value, onChange, counts, open, className }: { value: StageFilter; onChange: (v: StageFilter) => void; counts: Record<string, number>; open: number; className?: string }) {
  const { container, highlight } = useSlidingHighlight<HTMLDivElement, HTMLSpanElement>('[aria-pressed="true"]', value);
  const chips: StageFilter[] = ['all', ...SHOWN_STAGES];
  return (
    <div ref={container} className={cn('scroll-none relative flex gap-0.5 overflow-x-auto rounded-md bg-sunken/60 p-1 ring-1 ring-frame/15', className)}>
      <span ref={highlight} aria-hidden="true" className="absolute left-0 top-0 rounded-[5px] bg-surface opacity-0 shadow-soft ring-1 ring-frame/30 transition-[transform,width] duration-500 ease-spring" />
      {chips.map((c) => (
        <button
          key={c}
          aria-pressed={value === c}
          onClick={() => onChange(c)}
          title={c === 'all' ? 'Everything not closed' : STAGE_HINT[c]}
          className={cn(
            'relative z-[1] flex h-8 shrink-0 items-center gap-1.5 rounded-[5px] px-3 text-[13px] font-medium transition-colors duration-200',
            value === c ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {c !== 'all' && <StageMark stage={c} size={11} />}
          {c === 'all' ? 'All' : STAGE_LABEL[c]}
          <span className="font-mono text-[11px] tabular-nums opacity-60">{c === 'all' ? open : (counts[c] ?? 0)}</span>
        </button>
      ))}
    </div>
  );
}
