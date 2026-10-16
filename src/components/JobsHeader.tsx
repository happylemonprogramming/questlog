import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Globe2, KanbanSquare, Rocket, ScrollText } from 'lucide-react';
import { PageHeader } from '@/components/common';
import { useSlidingHighlight } from '@/lib/motion';
import { cn } from '@/lib/utils';

/** The ways to look at your quests. They share one place in the HUD. */
export const JOB_VIEWS = [
  { to: '/listings', label: 'Log', icon: <ScrollText /> },
  { to: '/pipeline', label: 'Board', icon: <KanbanSquare /> },
  { to: '/map', label: 'Map', icon: <Globe2 /> },
  { to: '/moonshots', label: 'Long shots', icon: <Rocket /> },
];

export const isJobsPath = (path: string) => path.startsWith('/jobs/') || path === '/review' || JOB_VIEWS.some((v) => path === v.to);

export function JobViews({ className }: { className?: string }) {
  const { pathname } = useLocation();
  const { container, highlight } = useSlidingHighlight<HTMLDivElement, HTMLSpanElement>('[aria-current="page"]', pathname);
  return (
    <div ref={container} className={cn('scroll-none relative flex w-fit max-w-full gap-0.5 overflow-x-auto rounded-md bg-sunken/60 p-1 ring-1 ring-frame/15 max-sm:w-full', className)}>
      <span ref={highlight} aria-hidden="true" className="absolute left-0 top-0 rounded-[5px] bg-surface opacity-0 shadow-soft ring-1 ring-frame/30 transition-[transform,width] duration-500 ease-spring" />
      {JOB_VIEWS.map((v) => (
        <NavLink
          key={v.to}
          to={v.to}
          className={({ isActive }) =>
            cn(
              'font-display relative z-[1] flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[5px] px-3.5 text-[15px] tracking-wide transition-colors [&_svg]:size-3.5 max-sm:flex-1 max-sm:px-2 max-sm:[&_svg]:hidden',
              isActive ? 'text-foreground [&_svg]:text-gold' : 'text-muted-foreground hover:text-foreground',
            )
          }
        >
          {v.icon}
          {v.label}
        </NavLink>
      ))}
    </div>
  );
}

/** One header for every quests view: the title, a line about this view, and the view switcher. */
export function JobsHeader({ sub, children, compact }: { sub?: ReactNode; children?: ReactNode; compact?: boolean }) {
  return (
    <PageHeader title="Quests" sub={sub} compact={compact}>
      <JobViews />
      {children}
    </PageHeader>
  );
}
