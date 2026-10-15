import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, MapPin, Rocket, Wallet } from 'lucide-react';
import { Badge, type Tone } from '@/components/ui/badge';
import { STAGE_LABEL, type Job, type Stage } from '@/lib/types';
import { cn, hueFor } from '@/lib/utils';

export function CompanyMark({ name, size = 36, className }: { name: string; size?: number; className?: string }) {
  const hue = hueFor(name || '?');
  const letters = (name || '?').replace(/\(.*?\)/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <div
      className={cn('grid shrink-0 place-items-center rounded-[10px] font-semibold tracking-tight', className)}
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
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow-label mb-1.5">{eyebrow}</p>}
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted-foreground">{sub}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-14 text-center">
      <div className="mb-3 grid size-11 place-items-center rounded-xl bg-muted text-muted-foreground [&_svg]:size-5">{icon}</div>
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

/** One listing as a row: the shape used by every list in the app. */
export function JobRow({ job, rank, right, compact }: { job: Job; rank?: ReactNode; right?: ReactNode; compact?: boolean }) {
  return (
    <Link
      to={`/jobs/${encodeURIComponent(job.id)}`}
      className="group flex items-center gap-3.5 rounded-xl px-3 py-2.5 transition-colors hover:bg-accent/70"
    >
      {rank}
      <CompanyMark name={job.company} size={compact ? 32 : 38} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[14px] font-medium leading-5">{job.title}</p>
          {job.moonshot && <Rocket className="size-3.5 shrink-0 text-violet" aria-label="Moonshot" />}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-x-3 text-[12.5px] text-muted-foreground">
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

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('rounded-2xl border bg-surface shadow-soft', className)}>{children}</div>;
}

export function CardHeader({ title, icon, action, count }: { title: string; icon?: ReactNode; action?: ReactNode; count?: number }) {
  return (
    <div className="flex items-center justify-between px-5 pb-2 pt-4">
      <div className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:text-muted-foreground">
        {icon}
        <h2 className="text-[13.5px] font-semibold tracking-tight">{title}</h2>
        {count !== undefined && <span className="font-mono text-xs text-muted-foreground">{count}</span>}
      </div>
      {action}
    </div>
  );
}
