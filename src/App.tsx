import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import * as D from '@radix-ui/react-dialog';
import { BrowserRouter, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ClipboardPen, FileText, Globe2, KanbanSquare, LayoutList, Loader2, Menu, Monitor, Moon, PanelRightOpen, PanelsTopLeft, Rocket, Settings as SettingsIcon, Sparkles, Sun, Sunrise,
} from 'lucide-react';
import { db, seedIfEmpty } from '@/lib/db';
import { ThemeProvider, useTheme, type Theme } from '@/lib/theme';
import { TooltipProvider, Tip } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { ChatPanel } from '@/components/ChatPanel';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ApplyPane } from '@/components/ApplyPane';
import { onAsk, useLive } from '@/agent/runtime';
import { setPane, useWorkspace } from '@/lib/workspace';
import { useIsMobile } from '@/lib/useMedia';
import { cn } from '@/lib/utils';
import Today from '@/pages/Today';
import Listings from '@/pages/Listings';
import Moonshots from '@/pages/Moonshots';
import Pipeline from '@/pages/Pipeline';
import JobView from '@/pages/JobView';
import Documents from '@/pages/Documents';
import DocumentView from '@/pages/DocumentView';
import Settings from '@/pages/Settings';
import PrintView from '@/pages/PrintView';

// The map library and its data are big; only load them when someone opens the map.
const MapView = lazy(() => import('@/pages/MapView'));

function Logo() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <div className="relative grid size-9 place-items-center rounded-[11px] bg-primary text-primary-foreground shadow-[0_6px_18px_-6px_hsl(var(--lemon)/0.55)] ring-1 ring-lemon/30">
        <svg viewBox="0 0 32 32" className="size-5" aria-hidden="true">
          <rect x="8" y="6" width="16" height="20" rx="2" fill="none" stroke="hsl(var(--lemon))" strokeWidth="2.4" />
          <path d="M12 12.5h8M12 16.5h8M12 20.5h5" stroke="hsl(var(--lemon))" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      </div>
      <div className="leading-none">
        <p className="text-[16px] font-semibold tracking-[-0.025em]">Offerdex</p>
        <p className="mt-0.5 font-mono text-[9.5px] uppercase tracking-[0.16em] text-muted-foreground">job search</p>
      </div>
    </div>
  );
}

function NavItem({ to, icon, label, end, standalone }: { to: string; icon: ReactNode; label: string; end?: boolean; standalone?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'group relative z-[1] flex h-10 items-center gap-3 rounded-xl px-3 text-[14px] font-medium transition-colors duration-200 [&_svg]:size-[18px] [&_svg]:transition-transform [&_svg]:duration-300 [&_svg]:ease-spring hover:[&_svg]:scale-110',
          isActive ? 'text-foreground [&_svg]:text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
          // Items outside the sliding highlight carry their own.
          isActive && standalone && 'bg-surface shadow-card ring-1 ring-border/80',
        )
      }
    >
      {icon}
      <span className="flex-1">{label}</span>
    </NavLink>
  );
}

function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  const opts: [Theme, ReactNode, string][] = [
    ['system', <Monitor key="s" />, 'System'],
    ['light', <Sun key="l" />, 'Light'],
    ['dark', <Moon key="d" />, 'Dark'],
  ];
  return (
    <div className="flex rounded-lg bg-muted p-0.5" role="radiogroup" aria-label="Theme">
      {opts.map(([t, icon, label]) => (
        <Tip key={t} label={label}>
          <button
            role="radio"
            aria-checked={theme === t}
            onClick={() => setTheme(t)}
            className={cn(
              'grid h-7 flex-1 place-items-center rounded-md transition [&_svg]:size-3.5',
              theme === t ? 'bg-surface text-foreground shadow-soft' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {icon}
          </button>
        </Tip>
      ))}
    </div>
  );
}

/** The highlight behind the current page, sliding between items as you navigate. */
function useNavIndicator() {
  const list = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    const active = list.current?.querySelector<HTMLElement>('a[aria-current="page"]');
    const el = pill.current;
    if (!el) return;
    if (!active) {
      el.style.opacity = '0';
      return;
    }
    const first = el.style.opacity !== '1';
    // No slide on first show; just appear in place.
    el.style.transition = first ? 'none' : '';
    el.style.transform = `translateY(${active.offsetTop}px)`;
    el.style.height = `${active.offsetHeight}px`;
    el.style.opacity = '1';
  }, [pathname]);
  return { list, pill };
}

function NavContents({ className }: { className?: string }) {
  const { list, pill } = useNavIndicator();
  return (
    <nav className={cn('flex flex-col gap-8 px-3.5 py-5', className)}>
      <Logo />
      <div ref={list} className="relative space-y-1">
        <div
          ref={pill}
          aria-hidden="true"
          className="absolute inset-x-0 top-0 rounded-xl bg-surface opacity-0 shadow-card ring-1 ring-border/80 transition-[transform,height] duration-500 ease-spring before:absolute before:inset-y-2.5 before:-left-3.5 before:w-[3px] before:rounded-r-full before:bg-lemon before:shadow-[0_0_12px_hsl(var(--lemon))]"
        />
        <NavItem to="/" end icon={<Sunrise />} label="Today" />
        <NavItem to="/listings" icon={<LayoutList />} label="Listings" />
        <NavItem to="/map" icon={<Globe2 />} label="Map" />
        <NavItem to="/moonshots" icon={<Rocket />} label="Moonshots" />
        <NavItem to="/pipeline" icon={<KanbanSquare />} label="Pipeline" />
        <NavItem to="/documents" icon={<FileText />} label="Documents" />
      </div>
      <div className="mt-auto space-y-3">
        <NavItem to="/settings" icon={<SettingsIcon />} label="Settings" standalone />
        <ThemeSwitch />
      </div>
    </nav>
  );
}

function Sidebar() {
  return <NavContents className="h-full w-[244px] shrink-0 border-r border-border/60 bg-sunken/70" />;
}

/** The sidebar as a drawer, for phones. Closes itself when you pick a page. */
function NavDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { pathname } = useLocation();
  useEffect(() => onOpenChange(false), [pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <D.Content onOpenAutoFocus={(e) => e.preventDefault()} className="fixed inset-y-0 left-0 z-50 flex w-[272px] max-w-[85vw] flex-col bg-background pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-lift data-[state=open]:animate-in data-[state=open]:slide-in-from-left">
          <D.Title className="sr-only">Navigation</D.Title>
          <NavContents className="h-full" />
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

const WIDTH_KEY = 'offerdex:chat-width';

/** Ask-from-page buttons bring the assistant forward. */
function useAskOpens(open: () => void) {
  const ref = useRef(open);
  ref.current = open;
  useEffect(() => onAsk(() => ref.current()), []);
}

function Page() {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary resetKey={pathname}>
      <Suspense fallback={<div className="grid h-40 place-items-center text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>}>
        {/* Keyed so each page fades up as you arrive. */}
        <div key={pathname} className="page-enter @container">
          <Outlet />
        </div>
      </Suspense>
    </ErrorBoundary>
  );
}

const TITLES: Record<string, [string, string?]> = {
  '': ['Today'],
  listings: ['Listings'],
  map: ['Map'],
  moonshots: ['Moonshots'],
  pipeline: ['Pipeline'],
  jobs: ['Listings', 'Listing'],
  documents: ['Documents', 'Document'],
  settings: ['Settings'],
};

function pageTitle(pathname: string) {
  const [, section = '', id] = pathname.split('/');
  const t = TITLES[section] ?? ['Offerdex'];
  return (id && t[1]) || t[0];
}

function TabButton({ active, onClick, icon, label, dot }: { active: boolean; onClick: () => void; icon: ReactNode; label: string; dot?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors [&_svg]:size-5',
        active ? 'text-foreground' : 'text-muted-foreground',
      )}
    >
      <span className={cn('relative grid h-7 w-12 place-items-center rounded-full transition-colors', active && 'bg-lemon-soft ring-1 ring-lemon/50')}>
        {icon}
        {dot && <span className="absolute right-2 top-0.5 size-2 rounded-full bg-lemon ring-2 ring-background" />}
      </span>
      {label}
    </button>
  );
}

/**
 * Phones: one pane at a time (the page, the assistant, or the application
 * form) with a tab bar. Every pane stays mounted so nothing is lost when you
 * switch, which is the main difference from hiding them by routing.
 */
function MobileShell() {
  const { pathname } = useLocation();
  const { pane, applyJobId } = useWorkspace();
  const live = useLive();
  const [drawer, setDrawer] = useState(false);
  const [pageDot, setPageDot] = useState(false);
  const [chatDot, setChatDot] = useState(false);
  const [typing, setTyping] = useState(false);
  const page = useRef<HTMLElement>(null);
  const paneRef = useRef(pane);
  paneRef.current = pane;

  useAskOpens(() => setPane('chat'));

  // Mark a tab when something changes on it while you're looking elsewhere.
  useEffect(() => {
    if (paneRef.current !== 'page') setPageDot(true);
    page.current?.scrollTo({ top: 0 });
  }, [pathname]);
  const running = !!live && !live.error;
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running && paneRef.current !== 'chat') setChatDot(true);
    wasRunning.current = running;
  }, [running]);
  useEffect(() => {
    if (pane === 'page') setPageDot(false);
    if (pane === 'chat') setChatDot(false);
  }, [pane]);

  // The on-screen keyboard needs the room the tab bar takes.
  useEffect(() => {
    const field = (t: EventTarget | null) => t instanceof HTMLElement && t.matches('textarea, input:not([type=checkbox]):not([type=radio]):not([type=file]), select, [contenteditable]');
    const onIn = (e: FocusEvent) => setTyping(field(e.target));
    // Wait a beat before bringing the bar back, so a tap that moves focus
    // doesn't shift the layout between press and release.
    const onOut = () => setTimeout(() => setTyping(field(document.activeElement)), 250);
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    return () => {
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
    };
  }, []);

  const title = pageTitle(pathname);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <div className="relative min-h-0 flex-1">
        <section className={cn('absolute inset-0 flex flex-col', pane !== 'page' && 'hidden')}>
          <header className="shrink-0 border-b border-border/60 bg-background/80 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
            <div className="flex h-12 items-center gap-2 px-2">
              <Button variant="ghost" size="icon" className="size-10" onClick={() => setDrawer(true)} aria-label="Menu"><Menu className="!size-5" /></Button>
              <p className="flex-1 truncate text-[15px] font-semibold tracking-tight">{title}</p>
            </div>
          </header>
          <main ref={page} className="scroll-thin relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="aurora" aria-hidden="true" />
            <div className="relative mx-auto w-full max-w-[860px] px-5 pb-12 pt-7 sm:px-6"><Page /></div>
          </main>
        </section>
        <section
          className={cn('absolute inset-0 pt-[env(safe-area-inset-top)]', pane !== 'chat' && 'hidden')}
          onClickCapture={(e) => {
            // Following a link from the chat means you want to see the page.
            if ((e.target as HTMLElement).closest('a[href^="/"]:not([target])')) setPane('page');
          }}
        >
          <ErrorBoundary><ChatPanel mobile /></ErrorBoundary>
        </section>
        <section className={cn('absolute inset-0 pt-[env(safe-area-inset-top)]', pane !== 'apply' && 'hidden')}>
          <ErrorBoundary><ApplyPane jobId={applyJobId} mobile /></ErrorBoundary>
        </section>
      </div>
      <nav className={cn('shrink-0 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur', typing && 'hidden')}>
        <div className="flex">
          <TabButton active={pane === 'page'} onClick={() => setPane('page')} icon={<PanelsTopLeft />} label={title || 'Page'} dot={pageDot} />
          <TabButton active={pane === 'chat'} onClick={() => setPane('chat')} icon={running ? <Loader2 className="animate-spin" /> : <Sparkles />} label="Assistant" dot={chatDot} />
          <TabButton active={pane === 'apply'} onClick={() => setPane('apply')} icon={<ClipboardPen />} label="Apply" dot={!!applyJobId && pane !== 'apply'} />
        </div>
      </nav>
      <NavDrawer open={drawer} onOpenChange={setDrawer} />
    </div>
  );
}

function DesktopShell() {
  const { pane, applyJobId } = useWorkspace();
  const applyJob = useLiveQuery(() => (applyJobId ? db.jobs.get(applyJobId) : undefined), [applyJobId]);
  const [open, setOpen] = useState(() => localStorage.getItem('offerdex:chat-open') !== '0');
  const [width, setWidth] = useState(() => Number(localStorage.getItem(WIDTH_KEY)) || 420);
  const showApply = !!applyJobId && pane === 'apply';

  useEffect(() => {
    localStorage.setItem('offerdex:chat-open', open ? '1' : '0');
  }, [open]);

  useAskOpens(() => setOpen(true));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function drag(e: React.PointerEvent) {
    const startX = e.clientX;
    const startW = width;
    let w = startW;
    const move = (ev: PointerEvent) => {
      w = Math.min(720, Math.max(340, startW + startX - ev.clientX));
      setWidth(w);
    };
    const up = () => {
      localStorage.setItem(WIDTH_KEY, String(w));
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
      document.body.classList.remove('resizing');
    };
    document.body.style.cursor = 'col-resize';
    // Keep the pointer from being swallowed by the application frame mid-drag.
    document.body.classList.add('resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        {applyJobId && (
          <div className="flex h-11 shrink-0 items-center gap-1 border-b bg-sunken/40 px-3">
            {([['page', <PanelsTopLeft key="p" />, 'Page'], ['apply', <ClipboardPen key="a" />, applyJob ? `Apply: ${applyJob.company}` : 'Application']] as const).map(([p, icon, label]) => (
              <button
                key={p}
                onClick={() => setPane(p)}
                className={cn(
                  'flex h-8 max-w-[280px] items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition [&_svg]:size-3.5 [&_svg]:shrink-0',
                  (p === 'apply') === showApply ? 'bg-surface text-foreground shadow-soft ring-1 ring-border' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {icon}<span className="truncate">{label}</span>
              </button>
            ))}
          </div>
        )}
        <main className={cn('scroll-thin relative min-h-0 flex-1 overflow-y-auto', showApply && 'hidden')}>
          <div className="aurora" aria-hidden="true" />
          {!open && (
            <div className="sticky top-0 z-10 flex justify-end p-3">
              <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="shadow-soft">
                <Sparkles className="text-lemon" /> Assistant <PanelRightOpen className="text-muted-foreground" />
              </Button>
            </div>
          )}
          <div className={cn('relative mx-auto w-full max-w-[1100px] px-10 pb-20', open ? 'pt-11' : '-mt-4')}>
            <Page />
          </div>
        </main>
        {applyJobId && (
          <div className={cn('min-h-0 flex-1', !showApply && 'hidden')}>
            <ErrorBoundary><ApplyPane jobId={applyJobId} /></ErrorBoundary>
          </div>
        )}
      </div>
      {/* Kept mounted while hidden so a running turn and page requests are never dropped. */}
      <div className={cn('relative shrink-0 border-l', open ? 'flex' : 'hidden')} style={{ width }}>
          <div
            onPointerDown={drag}
            className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize transition-colors hover:bg-lemon/40"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1"><ErrorBoundary><ChatPanel onClose={() => setOpen(false)} /></ErrorBoundary></div>
      </div>
    </div>
  );
}

function Shell() {
  return useIsMobile() ? <MobileShell /> : <DesktopShell />;
}

export default function App() {
  useEffect(() => {
    void seedIfEmpty();
    void navigator.storage?.persist?.();
  }, []);

  return (
    <ThemeProvider>
      <TooltipProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/print/:id" element={<PrintView />} />
            <Route element={<Shell />}>
              <Route index element={<Today />} />
              <Route path="listings" element={<Listings />} />
              <Route path="map" element={<MapView />} />
              <Route path="moonshots" element={<Moonshots />} />
              <Route path="pipeline" element={<Pipeline />} />
              <Route path="jobs/:id" element={<JobView />} />
              <Route path="documents" element={<Documents />} />
              <Route path="documents/:id" element={<DocumentView />} />
              <Route path="settings" element={<Settings />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  );
}
