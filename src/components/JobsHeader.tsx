import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Globe2, KanbanSquare, LayoutList, Rocket } from 'lucide-react';
import { PageHeader } from '@/components/common';
import { useSlidingHighlight } from '@/lib/motion';
import { cn } from '@/lib/utils';

/** The ways to look at your jobs. They share one place in the navigation. */
export const JOB_VIEWS = [
  { to: '/listings', label: 'List', icon: <LayoutList /> },
  { to: '/pipeline', label: 'Pipeline', icon: <KanbanSquare /> },
  { to: '/map', label: 'Map', icon: <Globe2 /> },
  { to: '/moonshots', label: 'Moonshots', icon: <Rocket /> },
];

export const isJobsPath = (path: string) => path.startsWith('/jobs/') || JOB_VIEWS.some((v) => path === v.to);

function JobViews() {
  const { pathname } = useLocation();
  const { container, highlight } = useSlidingHighlight<HTMLDivElement, HTMLSpanElement>('[aria-current="page"]', pathname);
  return (
    <div ref={container} className="scroll-none relative mb-7 flex w-fit max-w-full gap-0.5 overflow-x-auto rounded-xl bg-muted p-1 max-sm:w-full">
      <span ref={highlight} aria-hidden="true" className="absolute left-0 top-0 rounded-lg bg-surface opacity-0 shadow-soft transition-[transform,width] duration-500 ease-spring" />
      {JOB_VIEWS.map((v) => (
        <NavLink
          key={v.to}
          to={v.to}
          className={({ isActive }) =>
            cn(
              'relative z-[1] flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3.5 text-[13.5px] font-medium transition-colors [&_svg]:size-3.5 max-sm:flex-1 max-sm:px-2 max-sm:[&_svg]:hidden',
              isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
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

/** One header for every jobs view: the title, a line about this view, and the view switcher. */
export function JobsHeader({ sub, children }: { sub?: ReactNode; children?: ReactNode }) {
  return (
    <>
      <PageHeader title="Jobs" sub={sub}>{children}</PageHeader>
      <JobViews />
    </>
  );
}
