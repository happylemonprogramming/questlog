import { useEffect, useState } from 'react';
import { FolderOpen, FolderSearch, History, Loader2, RotateCcw, Trash2, Undo2 } from 'lucide-react';
import { chooseWorkspace, flush, useDisk } from '@/lib/disk';
import { desktop, type Snapshot } from '@/lib/desktop';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

const when = (at: number) => {
  const d = new Date(at);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

/** Shows a path with the home folder as ~, the way people recognize it. */
const pretty = (p: string) => p.replace(/^(\/home\/[^/]+|\/Users\/[^/]+|[A-Z]:\\Users\\[^\\]+)/, '~');

/** First start in the desktop app: say where files will go, and let the user pick somewhere else. */
export function WorkspaceWelcome() {
  const { info, ready } = useDisk();
  const [busy, setBusy] = useState(false);
  const open = ready && !!info && !info.root;
  const go = async (pick: boolean) => {
    setBusy(true);
    try {
      await chooseWorkspace(pick);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={() => {}} title="Where should your quest log live?" description="Questlog keeps your profile, jobs, resumes and letters as plain files in a folder you own. You can open them, back them up, or edit them yourself.">
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-xl bg-sunken px-4 py-3 font-mono text-[13px]">
          <FolderOpen className="size-4 shrink-0 text-gold" />
          <span className="truncate">{info && pretty(info.defaultRoot)}</span>
        </div>
        <p className="text-[12.5px] text-muted-foreground">Every change is kept in a history, so anything can be undone. You can move the folder later in Settings.</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={() => go(true)}><FolderSearch /> Choose another folder</Button>
          <Button variant="primary" disabled={busy} onClick={() => go(false)}>{busy && <Loader2 className="animate-spin" />} Use this folder</Button>
        </div>
      </div>
    </Dialog>
  );
}

/** Settings: the folder, and its history. */
export function WorkspaceSettings() {
  const d = desktop()!;
  const { info, error } = useDisk();
  const [snaps, setSnaps] = useState<Snapshot[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const refresh = () => void d.history.list().then(setSnaps);
  useEffect(refresh, [info?.root]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(what: string, fn: () => Promise<string | null | void>) {
    setBusy(what);
    setMsg(null);
    try {
      await flush();
      const r = await fn();
      if (r) setMsg(r);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      // Snapshots are taken a moment after changes settle.
      setTimeout(refresh, 3000);
      refresh();
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3 rounded-xl bg-sunken px-4 py-3 font-mono text-[13px]">
          <FolderOpen className="size-4 shrink-0 text-gold" />
          <span className="truncate">{info?.root ? pretty(info.root) : 'No folder yet'}</span>
        </div>
        <Button variant="outline" onClick={() => d.workspace.reveal()} disabled={!info?.root}><FolderOpen /> Open</Button>
        <Button variant="outline" onClick={() => run('move', () => chooseWorkspace(true))}><FolderSearch /> Change</Button>
      </div>
      {error && <p className="text-[13px] text-danger">{error}</p>}

      {info?.root && !info.history && (
        <p className="text-[12.5px] text-muted-foreground">This folder is inside a git repository of your own, so Questlog leaves its history to you.</p>
      )}

      {info?.history && (
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <p className="flex flex-1 items-center gap-2 text-[13px] font-medium"><History className="size-4 text-muted-foreground" /> History</p>
            <Button size="sm" variant="outline" disabled={!!busy || (snaps?.length ?? 0) < 2} onClick={() => run('undo', async () => { const u = await d.history.undo(); return u ? `Undid: ${u}` : null; })}>
              {busy === 'undo' ? <Loader2 className="animate-spin" /> : <Undo2 />} Undo last change
            </Button>
          </div>
          <ol className="scroll-thin max-h-72 divide-y overflow-y-auto rounded-xl border bg-surface">
            {snaps === null && <li className="p-3 text-[13px] text-muted-foreground">Loading…</li>}
            {snaps?.length === 0 && <li className="p-3 text-[13px] text-muted-foreground">Nothing yet.</li>}
            {snaps?.map((s, i) => (
              <li key={s.oid} className="group flex items-center gap-3 px-3 py-2">
                <span className="w-28 shrink-0 font-mono text-[11.5px] text-muted-foreground">{when(s.at)}</span>
                <span className={cn('min-w-0 flex-1 truncate text-[13px]', i === 0 && 'font-medium')}>{s.message}</span>
                {i > 0 && (
                  <Button size="sm" variant="ghost" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" disabled={!!busy} onClick={() => run(s.oid, async () => `Went back to ${await d.history.restore(s.oid) ? when(s.at) : 'that point'}.`)}>
                    {busy === s.oid ? <Loader2 className="animate-spin" /> : <RotateCcw />} Go back to this
                  </Button>
                )}
              </li>
            ))}
          </ol>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {msg && <p className="flex-1 text-[13px] text-muted-foreground">{msg}</p>}
            <span className="flex-1" />
            {confirmClear ? (
              <Button size="sm" variant="danger" className="bg-danger/10" onClick={() => { setConfirmClear(false); void run('clear', async () => { await d.history.clear(); return 'History cleared. Your files are as they were.'; }); }}>
                <Trash2 /> Yes, forget the history
              </Button>
            ) : (
              <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setConfirmClear(true)}><Trash2 /> Clear history</Button>
            )}
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground">Old versions stay in the history after you change or delete something. Clear it to forget them, for example old salary notes.</p>
        </div>
      )}
    </div>
  );
}
