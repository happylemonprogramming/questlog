import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CheckCircle2, Download, ExternalLink, Loader2, Plug, RefreshCw, Sparkles, Trash2, Upload, User, Database, XCircle } from 'lucide-react';
import { db, exportAll, getProfile, getSettings, uid, DEFAULT_SETTINGS } from '@/lib/db';
import { PRESETS, listModels } from '@/lib/providers';
import { importFile, type ImportResult } from '@/lib/importers';
import { analysisPrompt } from '@/lib/analysis';
import { ask } from '@/agent/runtime';
import { PageHeader } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import type { Profile, Provider } from '@/lib/types';
import { cn, download } from '@/lib/utils';

function Section({ icon, title, sub, children }: { icon: ReactNode; title: string; sub: string; children: ReactNode }) {
  return (
    <section className="grid grid-cols-1 gap-6 border-t py-8 first:border-t-0 first:pt-0 lg:grid-cols-[260px_minmax(0,1fr)]">
      <div>
        <div className="mb-2 grid size-9 place-items-center rounded-xl bg-muted text-muted-foreground [&_svg]:size-[18px]">{icon}</div>
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{sub}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="eyebrow-label">{label}</span>
      {children}
      {hint && <span className="block text-[12px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

function ProviderEditor() {
  const settings = useLiveQuery(() => getSettings(), []);
  const [draft, setDraft] = useState<Provider | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const active = settings?.providers.find((p) => p.id === settings.activeProviderId) ?? settings?.providers[0];

  useEffect(() => {
    if (active && !draft) setDraft(active);
  }, [active, draft]);

  async function test(p: Provider) {
    setBusy(true);
    setStatus(null);
    try {
      const list = await listModels(p);
      setModels(list);
      setStatus({ ok: true, text: `Connected. ${list.length} models available.` });
      if (!p.model && list.length) {
        const pick = [...list].reverse().find((m) => /sonnet/i.test(m)) ?? list[0];
        setDraft({ ...p, model: pick });
      }
    } catch (e) {
      setStatus({ ok: false, text: `Couldn't reach ${p.baseURL}: ${e instanceof Error ? e.message : e}. Check that it's running and allows this page's origin.` });
    } finally {
      setBusy(false);
    }
  }

  async function save(p: Provider) {
    const s = settings ?? DEFAULT_SETTINGS;
    const providers = s.providers.some((x) => x.id === p.id) ? s.providers.map((x) => (x.id === p.id ? p : x)) : [...s.providers, p];
    await db.settings.put({ ...s, providers, activeProviderId: p.id });
  }

  async function remove(p: Provider) {
    const s = settings ?? DEFAULT_SETTINGS;
    const providers = s.providers.filter((x) => x.id !== p.id);
    await db.settings.put({ ...s, providers, activeProviderId: providers[0]?.id });
    setDraft(providers[0] ?? null);
    setStatus(null);
    setModels([]);
  }

  function pick(preset: (typeof PRESETS)[number]) {
    const existing = settings?.providers.find((p) => p.baseURL === preset.baseURL);
    const p = existing ?? { id: uid(), name: preset.name, baseURL: preset.baseURL };
    setDraft(p);
    setStatus(null);
    setModels([]);
    if (preset.keyless) void test(p);
  }

  const preset = PRESETS.find((x) => x.baseURL === draft?.baseURL);

  return (
    <div className="space-y-5">
      <div className="grid gap-2.5 sm:grid-cols-2">
        {PRESETS.map((p) => {
          const selected = draft?.baseURL === p.baseURL;
          const connected = settings?.providers.some((x) => x.baseURL === p.baseURL && x.model);
          return (
            <button
              key={p.id}
              onClick={() => pick(p)}
              className={cn(
                'rounded-xl border bg-surface p-3.5 text-left transition hover:border-foreground/25',
                selected && 'border-lemon ring-2 ring-lemon/40',
              )}
            >
              <div className="flex items-center gap-2">
                <p className="text-[14px] font-semibold">{p.name}</p>
                {p.id === 'meridian' && <span className="rounded bg-lemon px-1.5 py-px font-mono text-[9.5px] font-bold uppercase text-lemon-foreground">Bring your own agent</span>}
                {connected && <CheckCircle2 className="ml-auto size-4 text-success" />}
              </div>
              <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">{p.blurb}</p>
            </button>
          );
        })}
        <button
          onClick={() => { setDraft({ id: uid(), name: 'Custom', baseURL: '' }); setStatus(null); setModels([]); }}
          className={cn('rounded-xl border border-dashed p-3.5 text-left transition hover:border-foreground/25', draft && !preset && 'border-lemon ring-2 ring-lemon/40')}
        >
          <p className="text-[14px] font-semibold">Custom</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">Any OpenAI-compatible endpoint.</p>
        </button>
      </div>

      {draft && (
        <div className="space-y-4 rounded-2xl border bg-surface p-5 shadow-soft">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name"><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
            <Field label="Base URL"><Input value={draft.baseURL} onChange={(e) => setDraft({ ...draft, baseURL: e.target.value })} placeholder="https://…/v1" className="font-mono text-[13px]" /></Field>
          </div>
          <Field
            label={preset?.keyless ? 'API key (optional)' : 'API key'}
            hint={preset?.keyURL ? <a href={preset.keyURL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">Get a key <ExternalLink className="size-3" /></a> : 'Stored only in this browser. Never included in exports.'}
          >
            <Input type="password" value={draft.apiKey ?? ''} onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })} className="font-mono text-[13px]" />
          </Field>
          {preset?.id === 'meridian' && (
            <p className="rounded-xl bg-sunken p-3 text-[12.5px] leading-relaxed text-muted-foreground">
              Run <code className="rounded bg-muted px-1 font-mono text-foreground">meridian</code> on this computer. Offerdex sends its own tools, and Meridian returns the calls here to run in your browser, so the model never touches your files. If you set <code className="rounded bg-muted px-1 font-mono text-foreground">MERIDIAN_API_KEY</code>, enter it above.
            </p>
          )}
          <Field label="Model">
            <div className="flex gap-2">
              {models.length ? (
                <select value={draft.model ?? ''} onChange={(e) => setDraft({ ...draft, model: e.target.value })} className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-surface px-3 font-mono text-[13px]">
                  <option value="" disabled>Choose a model</option>
                  {models.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              ) : (
                <Input value={draft.model ?? ''} onChange={(e) => setDraft({ ...draft, model: e.target.value })} placeholder="Test the connection to list models" className="font-mono text-[13px]" />
              )}
              <Button variant="outline" onClick={() => test(draft)} disabled={busy || !draft.baseURL}>
                {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} Test
              </Button>
            </div>
          </Field>
          {status && (
            <p className={cn('flex items-start gap-2 text-[13px]', status.ok ? 'text-success' : 'text-danger')}>
              {status.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <XCircle className="mt-0.5 size-4 shrink-0" />}
              {status.text}
            </p>
          )}
          <div className="flex items-center justify-between border-t pt-4">
            {settings?.providers.some((p) => p.id === draft.id) ? (
              <Button variant="danger" size="sm" onClick={() => remove(draft)}><Trash2 /> Remove</Button>
            ) : <span />}
            <Button variant="primary" onClick={() => save(draft)} disabled={!draft.baseURL || !draft.model}>
              {active?.id === draft.id ? 'Save' : 'Save and use'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileEditor() {
  const stored = useLiveQuery(() => getProfile(), []);
  const [p, setP] = useState<Profile | null>(null);
  const [dirty, setDirty] = useState(false);
  // Follow outside changes (the assistant's) until the user starts typing.
  useEffect(() => {
    if (stored && !dirty) setP(stored);
  }, [stored, dirty]);
  useEffect(() => {
    if (!dirty || !p) return;
    const t = setTimeout(async () => {
      await db.profile.put(p);
      setDirty(false);
    }, 500);
    return () => clearTimeout(t);
  }, [p, dirty]);
  if (!p) return null;
  const set = (patch: Partial<Profile>) => {
    setP({ ...p, ...patch });
    setDirty(true);
  };
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name"><Input value={p.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label="Location"><Input value={p.location ?? ''} onChange={(e) => set({ location: e.target.value })} /></Field>
      </div>
      <Field label="Search rules" hint="Pay floors, locations, seniority, travel, deal-breakers. The assistant checks every listing against these.">
        <Textarea value={p.rules} onChange={(e) => set({ rules: e.target.value })} className="min-h-[180px] font-mono text-[12.5px]" placeholder={'- Pay: $150k base or more\n- Location: remote, or within 30 minutes of home\n- No director-level roles'} />
      </Field>
      <Field label="Confirmed facts" hint="Things the assistant may say about you in tailored documents. It won't use anything that isn't here or in a base resume.">
        <Textarea value={p.facts} onChange={(e) => set({ facts: e.target.value })} className="min-h-[160px] font-mono text-[12.5px]" />
      </Field>
      <Field label="Working notes" hint="Open questions, decisions and next steps. Shown on Today, and the assistant keeps it current.">
        <Textarea value={p.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} className="min-h-[120px] font-mono text-[12.5px]" />
      </Field>
      <Field label="Writing style">
        <Textarea value={p.style} onChange={(e) => set({ style: e.target.value })} className="min-h-[100px] font-mono text-[12.5px]" placeholder={'- Plain, short sentences\n- No em-dashes'} />
      </Field>
      <p className="text-[12px] text-muted-foreground">Saved automatically.</p>
    </div>
  );
}

function DataTools() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [bundles, setBundles] = useState<ImportResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const settings = useLiveQuery(() => getSettings(), []);
  const connected = !!settings?.providers.some((p) => p.model);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    const lines: string[] = [];
    const withFiles: ImportResult[] = [];
    setBusy(true);
    try {
      for (const f of Array.from(files)) {
        const r = await importFile(f);
        const parts = [r.jobs && `${r.jobs} listings`, r.docs && `${r.docs} documents`, ...r.other, r.files && `${r.files.stored} files kept for the assistant`].filter(Boolean);
        lines.push(`${f.name}: ${parts.join(', ') || 'nothing recognized'}`);
        if (r.files) withFiles.push(r);
      }
      setMsg({ ok: true, text: `Imported ${lines.join('; ')}.` });
      setBundles(withFiles);
      // Hand the rest to the assistant right away when it can run.
      if (connected) withFiles.forEach((r) => ask(analysisPrompt(r)));
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); void onFiles(e.dataTransfer.files); }}
        onClick={() => fileRef.current?.click()}
        className="cursor-pointer rounded-2xl border-2 border-dashed bg-surface p-8 text-center transition hover:border-lemon hover:bg-lemon-soft/30"
      >
        {busy ? <Loader2 className="mx-auto mb-2 size-6 animate-spin text-muted-foreground" /> : <Upload className="mx-auto mb-2 size-6 text-muted-foreground" />}
        <p className="text-[14px] font-medium">Drop files to import</p>
        <p className="mx-auto mt-1 max-w-md text-[12.5px] text-muted-foreground">
          A <b>.zip</b> of your job-search folder, an Offerdex backup, a <code className="font-mono">seen_jobs.json</code>, or a tracker <code className="font-mono">.csv</code>. Known formats import directly. The assistant reads everything else in a zip and fills in your profile, listings and documents.
        </p>
        <input ref={fileRef} type="file" accept=".zip,.json,.csv" multiple hidden onChange={(e) => onFiles(e.target.files)} />
      </div>
      {msg && <p className={cn('text-[13px]', msg.ok ? 'text-success' : 'text-danger')}>{msg.text}</p>}
      {bundles.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-lemon-soft/60 px-4 py-3 text-[13px] ring-1 ring-lemon/50">
          <Sparkles className="size-4 text-foreground" />
          <span className="flex-1">
            {connected ? 'The assistant is reading your files now. Follow along in the chat panel.' : 'Connect an AI provider above, then let the assistant read your files.'}
          </span>
          {!connected ? null : (
            <Button size="sm" variant="outline" onClick={() => bundles.forEach((r) => ask(analysisPrompt(r)))}>Run again</Button>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={async () => download(`offerdex-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(await exportAll(), null, 2))}>
          <Download /> Export backup
        </Button>
        {confirmWipe ? (
          <Button variant="danger" className="bg-danger/10" onClick={async () => { await db.delete(); location.href = '/'; }}>
            <Trash2 /> Yes, erase everything
          </Button>
        ) : (
          <Button variant="danger" onClick={() => setConfirmWipe(true)}><Trash2 /> Erase all data</Button>
        )}
      </div>
    </div>
  );
}

export default function Settings() {
  return (
    <>
      <PageHeader eyebrow="Settings" title="Settings" sub="Everything is stored in this browser's IndexedDB. There's no account and no server." />
      <Section icon={<Plug />} title="AI provider" sub="Bring your own model. Any OpenAI-compatible endpoint works, including Meridian for a Claude subscription.">
        <ProviderEditor />
      </Section>
      <Section icon={<User />} title="Profile" sub="What the assistant knows about you and the rules it applies to every listing.">
        <ProfileEditor />
      </Section>
      <Section icon={<Database />} title="Data" sub="Bring in an existing search, or take everything with you.">
        <DataTools />
      </Section>
    </>
  );
}
