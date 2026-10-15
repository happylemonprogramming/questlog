import { useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, MapPin, Rocket, Wallet } from 'lucide-react';
import { Badge, type Tone } from '@/components/ui/badge';
import { STAGES, STAGE_LABEL, type Job, type Stage } from '@/lib/types';
import { useSlidingHighlight } from '@/lib/motion';
import { cn, hueFor } from '@/lib/utils';
import { companyDomain, logoUrl, missingLogos, useLogos } from '@/lib/logo';

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
      className={cn('relative grid shrink-0 place-items-center overflow-hidden rounded-[10px] font-semibold tracking-tight', className)}
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
        <span className={cn('absolute inset-0 grid place-items-center bg-white ring-1 ring-inset ring-black/5 transition-opacity duration-300', shown === want ? 'opacity-100' : 'opacity-0')}>
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
  next: 'lemon',
  applied: 'info',
  interviewing: 'violet',
  offer: 'success',
  closed: 'neutral',
};

export const STAGE_DOT: Record<Stage, string> = {
  inbox: 'bg-muted-foreground/40',
  saved: 'bg-muted-foreground',
  next: 'bg-lemon',
  applied: 'bg-info',
  interviewing: 'bg-violet',
  offer: 'bg-success',
  closed: 'bg-muted-foreground/30',
};

/** The CSS color variable for each stage, for glows and tints. */
export const STAGE_VAR: Record<Stage, string> = {
  inbox: '--muted-foreground',
  saved: '--muted-foreground',
  next: '--lemon',
  applied: '--info',
  interviewing: '--violet',
  offer: '--success',
  closed: '--muted-foreground',
};

export function StageBadge({ stage }: { stage: Stage }) {
  return (
    <Badge tone={STAGE_TONE[stage]}>
      <span className={cn('size-1.5 rounded-full', STAGE_DOT[stage])} />
      {STAGE_LABEL[stage]}
    </Badge>
  );
}

export function PageHeader({ eyebrow, title, children, sub }: { eyebrow?: string; title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && (
          <p className="eyebrow-label mb-2.5 flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-lemon shadow-[0_0_10px_hsl(var(--lemon))]" />
            {eyebrow}
          </p>
        )}
        <h1 className="text-[28px] font-semibold leading-[1.1] tracking-[-0.03em] md:text-[34px]">{title}</h1>
        {sub && <p className="mt-2 text-[14.5px] text-muted-foreground">{sub}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-border/80 px-6 py-16 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-lemon/25 to-violet/20 text-foreground ring-1 ring-border [&_svg]:size-5">{icon}</div>
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

/** One listing as a row: the shape used by every list in the app. */
export function JobRow({ job, rank, right, compact, index }: { job: Job; rank?: ReactNode; right?: ReactNode; compact?: boolean; index?: number }) {
  return (
    <Link
      to={`/jobs/${encodeURIComponent(job.id)}`}
      className={cn('group flex items-center gap-3.5 rounded-2xl px-3 py-3 transition-colors duration-200 hover:bg-accent/60', index !== undefined && 'rise')}
      style={index !== undefined ? ({ '--i': index } as CSSProperties) : undefined}
    >
      {rank}
      <CompanyMark job={job} size={compact ? 32 : 38} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[14.5px] font-medium leading-5 tracking-[-0.005em] transition-colors group-hover:text-foreground">{job.title}</p>
          {job.moonshot && <Rocket className="size-3.5 shrink-0 text-violet" aria-label="Moonshot" />}
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-x-3 text-[12.5px] text-muted-foreground">
          <span className="truncate font-medium text-foreground/75">{job.company}</span>
          {job.location && !compact && (
            <span className="hidden min-w-0 items-center gap-1 sm:flex">
              <MapPin className="size-3 shrink-0" />
              <span className="truncate">{job.location}</span>
            </span>
          )}
          {job.pay && !/^not listed/i.test(job.pay) && (
            <span className="hidden shrink-0 items-center gap-1 whitespace-nowrap font-mono text-[11.5px] md:flex">
              <Wallet className="size-3" />
              {shortPay(job.pay)}
            </span>
          )}
        </div>
      </div>
      {!compact && job.flags?.length ? (
        <Badge tone="warning" className="hidden lg:inline-flex" title={job.flags.join('\n')}>
          <AlertTriangle />
          {job.flags.length === 1 ? job.flags[0] : `${job.flags.length} flags`}
        </Badge>
      ) : null}
      {right ?? <StageBadge stage={job.stage} />}
    </Link>
  );
}

export function shortPay(pay: string) {
  const p = pay.replace(/\s*\(.*\)$/, '');
  return p.length > 26 ? `${p.slice(0, 25)}…` : p;
}

export function Card({ className, children, style }: { className?: string; children: ReactNode; style?: CSSProperties }) {
  return <div className={cn('rounded-3xl border border-border/70 bg-surface shadow-card', className)} style={style}>{children}</div>;
}

export function CardHeader({ title, icon, action, count }: { title: string; icon?: ReactNode; action?: ReactNode; count?: number }) {
  return (
    <div className="flex items-center justify-between px-6 pb-2 pt-5">
      <div className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:text-muted-foreground">
        {icon}
        <h2 className="text-[14.5px] font-semibold tracking-tight">{title}</h2>
        {count !== undefined && <span className="font-mono text-xs text-muted-foreground">{count}</span>}
      </div>
      {action}
    </div>
  );
}

export type StageFilter = Stage | 'all';

/** "Open" plus each stage, with counts. The highlight slides to the one you pick. */
export function StageChips({ value, onChange, counts, open }: { value: StageFilter; onChange: (v: StageFilter) => void; counts: Record<string, number>; open: number }) {
  const { container, highlight } = useSlidingHighlight<HTMLDivElement, HTMLSpanElement>('[aria-pressed="true"]', value);
  const chips: StageFilter[] = ['all', ...STAGES];
  return (
    <div ref={container} className="scroll-none relative mb-6 flex gap-1 overflow-x-auto pb-1">
      <span ref={highlight} aria-hidden="true" className="absolute left-0 top-0 rounded-full bg-primary opacity-0 shadow-soft transition-[transform,width] duration-500 ease-spring" />
      {chips.map((c) => (
        <button
          key={c}
          aria-pressed={value === c}
          onClick={() => onChange(c)}
          className={cn(
            'relative z-[1] flex h-9 shrink-0 items-center gap-2 rounded-full px-3.5 text-[13.5px] font-medium transition-colors duration-200',
            value === c ? 'text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          {c !== 'all' && <span className={cn('size-1.5 rounded-full', STAGE_DOT[c])} />}
          {c === 'all' ? 'Open' : STAGE_LABEL[c]}
          <span className="font-mono text-[11px] tabular-nums opacity-60">{c === 'all' ? open : (counts[c] ?? 0)}</span>
        </button>
      ))}
    </div>
  );
}
