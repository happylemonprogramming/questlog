import type { ReactNode } from 'react';
import { Bookmark, ClipboardPen, ListPlus, RotateCcw, Send, Undo2, X } from 'lucide-react';
import { db, moveJob } from '@/lib/db';
import { applicationPage, openApplication } from '@/lib/workspace';
import { shownStage, type Job } from '@/lib/types';
import { Tip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface Action {
  label: string;
  /** A one-word label for the touch buttons. */
  short?: string;
  icon: ReactNode;
  run: () => unknown;
  primary?: boolean;
}

/** The next moves that make sense for a listing where it stands, so sorting is one tap. */
export function actionsFor(job: Job): Action[] {
  const close = (label: string, note: string, outcome?: Job['outcome'], short = 'Pass'): Action => ({
    label,
    short,
    icon: <X />,
    run: async () => {
      await moveJob(job, 'closed', note);
      if (outcome) await db.jobs.update(job.id, { outcome });
    },
  });
  switch (shownStage(job.stage)) {
    case 'inbox':
      return [
        { label: 'Save for later', short: 'Save', icon: <Bookmark />, run: () => moveJob(job, 'saved') },
        { label: 'Up next', icon: <ListPlus />, run: () => moveJob(job, 'next'), primary: true },
        close('Not for me', 'Passed', 'skipped'),
      ];
    case 'saved':
      return [
        { label: 'Up next', icon: <ListPlus />, run: () => moveJob(job, 'next'), primary: true },
        close('Not for me', 'Passed', 'skipped'),
      ];
    case 'next': {
      const apply: Action[] = applicationPage(job)
        ? [{ label: 'Apply here', short: 'Apply', icon: <ClipboardPen />, run: () => openApplication(job.id), primary: true }]
        : job.url ? [{ label: 'Open the application', short: 'Apply', icon: <ClipboardPen />, run: () => window.open(job.url, '_blank', 'noopener'), primary: true }] : [];
      return [...apply, { label: 'I sent it', short: 'Sent', icon: <Send />, run: () => moveJob(job, 'applied') }, { label: 'Later', icon: <Undo2 />, run: () => moveJob(job, 'saved', 'Set aside') }];
    }
    case 'applied':
      return [close('Didn’t work out', 'Closed after applying', 'rejected', 'No luck')];
    case 'closed':
      return [{ label: 'Reopen', icon: <RotateCcw />, run: () => moveJob(job, 'saved', 'Reopened') }];
    default:
      return [];
  }
}

const runner = (a: Action) => (e: React.MouseEvent) => {
  e.preventDefault();
  e.stopPropagation();
  void a.run();
};

/** Labeled buttons on their own line, for touch screens where there's no hover or tooltip. */
export function QuickPills({ job, className }: { job: Job; className?: string }) {
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {actionsFor(job).map((a) => (
        <button
          key={a.label}
          onClick={runner(a)}
          className={cn(
            'flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition active:scale-95 [&_svg]:size-3.5',
            a.primary ? 'bg-lemon text-lemon-foreground' : 'bg-muted text-foreground/80',
          )}
        >
          {a.icon}
          {a.short ?? a.label}
        </button>
      ))}
    </div>
  );
}

export function QuickActions({ job, className }: { job: Job; className?: string }) {
  return (
    <div className={cn('flex items-center gap-1', className)}>
      {actionsFor(job).map((a) => (
        <Tip key={a.label} label={a.label}>
          <button
            aria-label={a.label}
            onClick={runner(a)}
            className={cn(
              'grid size-8 place-items-center rounded-lg transition-[background-color,color,transform] duration-150 active:scale-90 [&_svg]:size-4',
              a.primary ? 'bg-lemon text-lemon-foreground shadow-soft hover:brightness-105' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {a.icon}
          </button>
        </Tip>
      ))}
    </div>
  );
}
