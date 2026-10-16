import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import * as D from '@radix-ui/react-dialog';
import { BrowserRouter, Link, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  BookOpen, ClipboardPen, FileText, Loader2, Map as MapIcon, Menu, Monitor, Moon, PanelsTopLeft, Settings as SettingsIcon, Sparkles, Sun, Tent,
} from 'lucide-react';
import { roman, useDailyGoal, useJourney, useWeeklyGoal } from '@/lib/quest';
import { Milestones, useXpGain } from '@/components/Milestones';
import { Hearts, Ring, XpBar } from '@/components/game';
import { db } from '@/lib/db';
import { adoptBaseResumes } from '@/lib/career';
import { ThemeProvider, useTheme, type Theme } from '@/lib/theme';
import { TooltipProvider, Tip } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { ChatPanel } from '@/components/ChatPanel';
import { CommandDock } from '@/components/CommandDock';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ApplyPane } from '@/components/ApplyPane';
import { WorkspaceWelcome } from '@/components/WorkspacePanel';
import { startDisk } from '@/lib/disk';
import { isDesktop } from '@/lib/desktop';
import { isJobsPath } from '@/components/JobsHeader';
import { onAsk, useLive } from '@/agent/runtime';
import { serveTools } from '@/agent/serve';
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
import Journal from '@/pages/Journal';
import Review from '@/pages/Review';
import TurnIn from '@/pages/TurnIn';
import PrintView from '@/pages/PrintView';

// The map library and its data are big; only load them when someone opens the map.
const MapView = lazy(() => import('@/pages/MapView'));

/** The mark: a waypoint at the end of a trail of steps. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <path d="M7 25.6c4.2.2 7.8-1.6 10-5.2" fill="none" stroke="hsl(var(--gold))" strokeWidth="2.2" strokeLinecap="round" strokeDasharray=".01 3.5" opacity=".7" />
      <path d="M19.5 4.8l5.8 6.9-5.8 6.9-5.8-6.9z" fill="hsl(var(--gold))" />
      <circle cx="19.5" cy="11.7" r="2.1" fill="hsl(24 17% 11.5%)" />
    </svg>
  );
}

function Wordmark({ small }: { small?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
      <span className={cn('grid place-items-center rounded-[7px] bg-[#221c18] ring-1 ring-gold/40 shadow-[0_4px_14px_-6px_hsl(var(--gold)/0.6)]', small ? 'size-7' : 'size-8')}>
        <Mark className={small ? 'size-6' : 'size-7'} />
      </span>
      {!small && <span className="font-display text-[21px] leading-none">Questlog</span>}
    </Link>
  );
}

const PLACES: { to: string; icon: ReactNode; label: string; match: (p: string) => boolean }[] = [
  { to: '/', icon: <Tent />, label: 'Camp', match: (p) => p === '/' || p.startsWith('/turn-in') },
  { to: '/listings', icon: <MapIcon />, label: 'Quests', match: isJobsPath },
  { to: '/documents', icon: <FileText />, label: 'Documents', match: (p) => p.startsWith('/documents') },
  { to: '/journal', icon: <BookOpen />, label: 'Journal', match: (p) => p.startsWith('/journal') },
];

/** The places you can go, as tabs in the HUD. The gold cursor sits under the one you're in. */
function Places({ className, vertical }: { className?: string; vertical?: boolean }) {
  const { pathname } = useLocation();
  return (
    <nav className={cn('flex', vertical ? 'flex-col gap-1' : 'items-center gap-0.5', className)} aria-label="Places">
      {PLACES.map((p) => {
        const active = p.match(pathname);
        return (
          <Link
            key={p.to}
            to={p.to}
            aria-current={active ? 'page' : undefined}
            className={cn('hud-tab', vertical && 'h-11 px-3 text-[19px] [&_svg]:size-[18px]', active && '[&_svg]:text-gold')}
          >
            {p.icon}
            {p.label}
            {!vertical && (
              <span
                aria-hidden="true"
                className={cn(
                  'absolute inset-x-3 -bottom-[7px] h-[2px] rounded-full bg-gold shadow-[0_0_8px_hsl(var(--gold))] transition-[transform,opacity] duration-500 ease-spring',
                  active ? 'opacity-100' : 'scale-x-0 opacity-0',
                )}
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function ThemeSwitch({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const opts: [Theme, ReactNode, string][] = [
    ['system', <Monitor key="s" />, 'System'],
    ['light', <Sun key="l" />, 'Day'],
    ['dark', <Moon key="d" />, 'Night'],
  ];
  return (
    <div className={cn('flex rounded-md bg-sunken/70 p-0.5 ring-1 ring-frame/15', className)} role="radiogroup" aria-label="Theme">
      {opts.map(([t, icon, label]) => (
        <Tip key={t} label={label}>
          <button
            role="radio"
            aria-checked={theme === t}
            onClick={() => setTheme(t)}
            className={cn(
              'grid h-7 w-8 place-items-center rounded-[5px] transition [&_svg]:size-3.5',
              theme === t ? 'bg-surface text-foreground shadow-soft ring-1 ring-frame/30' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {icon}
          </button>
        </Tip>
      ))}
    </div>
  );
}

/**
 * Status in the HUD: today's hearts, the week's ring, and the chapter with
 * its experience bar. Points just earned float up beside the bar.
 */
function Status({ compact }: { compact?: boolean }) {
  const j = useJourney();
  const [daily, cycleDaily] = useDailyGoal();
  const [weekly] = useWeeklyGoal();
  const gain = useXpGain();
  const [surge, setSurge] = useState(0);
  useEffect(() => {
    if (gain) setSurge(gain.key);
  }, [gain]);
  if (!j) return <div className="h-8" />;
  const { level } = j;
  return (
    <div className={cn('flex items-center', compact ? 'gap-3' : 'gap-5')}>
      <Hearts
        filled={j.sentToday}
        total={daily}
        size={compact ? 14 : 16}
        onClick={cycleDaily}
        title={`${j.sentToday} of ${daily} sent today. Tap to change today's goal.`}
      />
      <Ring value={j.sentThisWeek} max={weekly} size={compact ? 24 : 28} title={`${j.sentThisWeek} of ${weekly} this week`}>
        <span className="font-mono text-[9px] font-semibold tabular-nums">{j.sentThisWeek}</span>
      </Ring>
      <Link to="/journal" className="group relative block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/60" title={`${level.into} of ${level.span} to the next chapter`}>
        <div className={cn('flex items-baseline justify-between gap-3 leading-none', compact ? 'w-[96px]' : 'w-[150px]')}>
          <span className="font-display text-[14px] tracking-wide">
            Ch. {roman(level.level)}
            {!compact && <span className="ml-1.5 text-muted-foreground">{level.title}</span>}
          </span>
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{level.xp}</span>
        </div>
        <XpBar key={surge} into={level.into} span={level.span} surge={surge > 0} className="mt-1.5" />
        {gain && (
          <span key={gain.key} className="float-up pointer-events-none absolute -top-5 right-0 font-mono text-[12px] font-semibold text-gold-ink">
            +{gain.xp}
          </span>
        )}
      </Link>
    </div>
  );
}

const WIDTH_KEY = 'questlog:chat-width';
const OPEN_KEY = 'questlog:assistant-open';

/** Ask-from-page buttons bring the companion forward. */
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
        {/* Keyed so each screen fades up as you arrive. */}
        <div key={pathname} className="page-enter @container">
          <Outlet />
        </div>
      </Suspense>
    </ErrorBoundary>
  );
}

/** A faint dotted trail wandering behind the screen, the way a map draws a route. */
function Trail() {
  return (
    <svg className="trail" aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 1200 900">
      <path
        d="M-40 120 C 160 80, 260 240, 420 200 S 700 60, 860 160 S 1100 420, 1260 380"
        fill="none"
        stroke="hsl(var(--trail) / 0.5)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="0.1 11"
      />
      <path
        d="M-40 640 C 200 560, 380 760, 600 680 S 980 540, 1260 700"
        fill="none"
        stroke="hsl(var(--trail) / 0.35)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="0.1 11"
      />
    </svg>
  );
}

const TITLES: Record<string, [string, string?]> = {
  '': ['Camp'],
  listings: ['Quests'],
  map: ['Quests'],
  moonshots: ['Quests'],
  pipeline: ['Quests'],
  jobs: ['Quests', 'Quest'],
  journal: ['Journal'],
  documents: ['Documents', 'Document'],
  settings: ['Settings'],
  review: ['Choose'],
  'turn-in': ['Camp', 'Turn in'],
};

function pageTitle(pathname: string) {
  const [, section = '', id] = pathname.split('/');
  const t = TITLES[section] ?? ['Questlog'];
  return (id && t[1]) || t[0];
}

function TabButton({ active, onClick, icon, label, dot }: { active: boolean; onClick: () => void; icon: ReactNode; label: string; dot?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'font-display relative flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[13px] tracking-wide transition-colors [&_svg]:size-5',
        active ? 'text-foreground' : 'text-muted-foreground',
      )}
    >
      <span className={cn('relative grid h-7 w-12 place-items-center rounded-md transition-colors', active && 'bg-gold-soft ring-1 ring-gold/50')}>
        {icon}
        {dot && <span className="absolute right-2 top-0.5 size-2 rounded-full bg-gold ring-2 ring-background" />}
      </span>
      {label}
    </button>
  );
}

/** The places as a drawer, for phones. Closes itself when you pick one. */
function PlacesDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { pathname } = useLocation();
  useEffect(() => onOpenChange(false), [pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <D.Content onOpenAutoFocus={(e) => e.preventDefault()} className="fixed inset-y-0 left-0 z-50 flex w-[272px] max-w-[85vw] flex-col bg-background pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-lift data-[state=open]:animate-in data-[state=open]:slide-in-from-left">
          <D.Title className="sr-only">Places</D.Title>
          <div className="flex h-full flex-col gap-6 px-4 py-5">
            <Wordmark />
            <Places vertical />
            <div className="mt-auto space-y-3">
              <Link to="/settings" className="hud-tab h-11 px-3 text-[19px] [&_svg]:size-[18px]"><SettingsIcon /> Settings</Link>
              <ThemeSwitch className="w-fit" />
            </div>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/**
 * Phones: one pane at a time (the screen, the companion, or the application
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
          <header className="hud shrink-0 pt-[env(safe-area-inset-top)]">
            <div className="flex h-12 items-center gap-2 px-2">
              <Button variant="ghost" size="icon" className="size-10" onClick={() => setDrawer(true)} aria-label="Places"><Menu className="!size-5" /></Button>
              <p className="font-display flex-1 truncate text-[19px]">{title}</p>
              <div className="pr-1"><Status compact /></div>
            </div>
          </header>
          <main ref={page} className="scroll-thin relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="aurora" aria-hidden="true" />
            <Trail />
            <div className="relative mx-auto w-full max-w-[860px] px-5 pb-6 pt-6 sm:px-6"><Page /></div>
            <div className="pointer-events-none sticky bottom-0 z-20 bg-gradient-to-t from-background via-background/85 to-transparent px-4 pb-3 pt-8">
              <CommandDock mobile />
            </div>
          </main>
        </section>
        <section
          className={cn('absolute inset-0 pt-[env(safe-area-inset-top)]', pane !== 'chat' && 'hidden')}
          onClickCapture={(e) => {
            // Following a link from the chat means you want to see the screen.
            if ((e.target as HTMLElement).closest('a[href^="/"]:not([target])')) setPane('page');
          }}
        >
          <ErrorBoundary><ChatPanel mobile /></ErrorBoundary>
        </section>
        <section className={cn('absolute inset-0 pt-[env(safe-area-inset-top)]', pane !== 'apply' && 'hidden')}>
          <ErrorBoundary><ApplyPane jobId={applyJobId} mobile /></ErrorBoundary>
        </section>
      </div>
      <nav className={cn('hud shrink-0 !border-b-0 border-t border-frame/30 pb-[env(safe-area-inset-bottom)]', typing && 'hidden')}>
        <div className="flex">
          <TabButton active={pane === 'page'} onClick={() => setPane('page')} icon={<PanelsTopLeft />} label={title || 'Screen'} dot={pageDot} />
          <TabButton active={pane === 'chat'} onClick={() => setPane('chat')} icon={running ? <Loader2 className="animate-spin" /> : <Sparkles />} label="Guide" dot={chatDot} />
          <TabButton active={pane === 'apply'} onClick={() => setPane('apply')} icon={<ClipboardPen />} label="Apply" dot={!!applyJobId && pane !== 'apply'} />
        </div>
      </nav>
      <PlacesDrawer open={drawer} onOpenChange={setDrawer} />
    </div>
  );
}

function DesktopShell() {
  const { pane, applyJobId } = useWorkspace();
  const applyJob = useLiveQuery(() => (applyJobId ? db.jobs.get(applyJobId) : undefined), [applyJobId]);
  const live = useLive();
  const { pathname } = useLocation();
  // Closed until asked for: the screen should be the first thing you see.
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) === '1');
  const [width, setWidth] = useState(() => Number(localStorage.getItem(WIDTH_KEY)) || 420);
  const showApply = !!applyJobId && pane === 'apply';
  const running = !!live && !live.error;

  useEffect(() => {
    localStorage.setItem(OPEN_KEY, open ? '1' : '0');
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

  const inSettings = pathname.startsWith('/settings');

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* The HUD: where you are, how today and the week are going, and the companion. */}
      <header className="hud relative z-30 shrink-0">
        <div className="flex h-[52px] items-center gap-6 px-4">
          <Wordmark />
          <Places className="ml-2" />
          <div className="ml-auto flex items-center gap-4">
            <Status />
            <span className="h-6 w-px bg-frame/25" aria-hidden="true" />
            <Tip label={open ? 'Close the guide (⌘J)' : 'Call the guide (⌘J)'}>
              <button
                onClick={() => setOpen((o) => !o)}
                aria-pressed={open}
                className={cn(
                  'font-display flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[15px] tracking-wide transition [&_svg]:size-4',
                  open ? 'bg-gold-soft text-foreground ring-1 ring-gold/50' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                {running ? <Loader2 className="animate-spin text-gold" /> : <Sparkles className="text-gold" />}
                Guide
              </button>
            </Tip>
            <Tip label="Settings">
              <Link
                to="/settings"
                aria-current={inSettings ? 'page' : undefined}
                className={cn('grid size-8 place-items-center rounded-md transition [&_svg]:size-4', inSettings ? 'bg-gold-soft text-foreground ring-1 ring-gold/50' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}
              >
                <SettingsIcon />
              </Link>
            </Tip>
          </div>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {applyJobId && (
            <div className="flex h-10 shrink-0 items-center gap-1 border-b border-frame/25 bg-sunken/40 px-3">
              {([['page', <PanelsTopLeft key="p" />, 'Screen'], ['apply', <ClipboardPen key="a" />, applyJob ? `Apply: ${applyJob.company}` : 'Application']] as const).map(([p, icon, label]) => (
                <button
                  key={p}
                  onClick={() => setPane(p)}
                  className={cn(
                    'flex h-7 max-w-[280px] items-center gap-1.5 rounded-[5px] px-3 text-[13px] font-medium transition [&_svg]:size-3.5 [&_svg]:shrink-0',
                    (p === 'apply') === showApply ? 'bg-surface text-foreground shadow-soft ring-1 ring-frame/30' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {icon}<span className="truncate">{label}</span>
                </button>
              ))}
            </div>
          )}
          <main className={cn('scroll-thin relative min-h-0 flex-1 overflow-y-auto', showApply && 'hidden')}>
            <div className="aurora" aria-hidden="true" />
            <Trail />
            <div className={cn('relative mx-auto w-full max-w-[1120px] px-10 pt-9', open ? 'pb-16' : 'pb-6')}>
              <Page />
            </div>
            {!open && (
              <div className="pointer-events-none sticky bottom-0 z-20 flex justify-center bg-gradient-to-t from-background via-background/80 to-transparent px-10 pb-5 pt-10">
                <CommandDock className="max-w-[640px]" />
              </div>
            )}
          </main>
          {applyJobId && (
            <div className={cn('min-h-0 flex-1', !showApply && 'hidden')}>
              <ErrorBoundary><ApplyPane jobId={applyJobId} /></ErrorBoundary>
            </div>
          )}
        </div>
        {/* Kept mounted while hidden so a running turn and page requests are never dropped. */}
        <div className={cn('relative shrink-0 border-l border-frame/30', open ? 'flex' : 'hidden')} style={{ width }}>
          <div
            onPointerDown={drag}
            className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize transition-colors hover:bg-gold/40"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1"><ErrorBoundary><ChatPanel onClose={() => setOpen(false)} /></ErrorBoundary></div>
        </div>
      </div>
    </div>
  );
}

function Shell() {
  // In the desktop app, an external agent (Claude Code, Codex…) works through this window's tools.
  const navigate = useNavigate();
  const nav = useRef(navigate);
  nav.current = navigate;
  useEffect(() => serveTools({ navigate: (p) => nav.current(p) }), []);
  const mobile = useIsMobile();
  return (
    <>
      {mobile ? <MobileShell /> : <DesktopShell />}
      {isDesktop() && <WorkspaceWelcome />}
      <Milestones />
    </>
  );
}

export default function App() {
  useEffect(() => {
    void adoptBaseResumes();
    void navigator.storage?.persist?.();
    // Print views are hidden windows of their own; only the main window keeps the folder in step.
    if (!location.pathname.startsWith('/print/')) void startDisk();
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
              <Route path="journal" element={<Journal />} />
              <Route path="review" element={<Review />} />
              <Route path="turn-in/:id" element={<TurnIn />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  );
}
