import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Plus } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getPosting, parsePostingUrl } from '@/lib/boards';
import { db, uid, upsertJob } from '@/lib/db';
import { slugify } from '@/lib/utils';

/** Paste a Greenhouse, Ashby or Lever link and it fills itself in; anything else is entered by hand. */
export function AddJobButton({ variant = 'primary' }: { variant?: 'primary' | 'outline' }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [company, setCompany] = useState('');
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [pay, setPay] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const ref = parsePostingUrl(url);

  async function save() {
    setBusy(true);
    setError('');
    try {
      let id: string;
      if (ref) {
        const p = await getPosting(ref.ats, ref.board, ref.id);
        id = `${p.ats}:${p.board}:${p.id}`;
        const prev = await db.jobs.get(id);
        await upsertJob({
          id,
          portal: p.ats,
          company: prev?.company ?? (company || p.board.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())),
          title: p.title,
          location: p.location,
          url: p.url,
          pay: p.pay ?? prev?.pay ?? 'not listed',
          payMin: p.payMin,
          payMax: p.payMax,
          remote: p.remote,
          posted: p.posted,
          description: p.text,
          stage: prev?.stage ?? 'saved',
        });
      } else {
        id = `manual:${slugify(company)}:${uid()}`;
        await upsertJob({ id, company, title, location, url: url || undefined, pay: pay || undefined, portal: 'manual', stage: 'saved' });
      }
      setOpen(false);
      setUrl(''); setCompany(''); setTitle(''); setLocation(''); setPay('');
      navigate(`/jobs/${encodeURIComponent(id)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Plus /> New quest
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title="Take on a new quest" description="Paste a Greenhouse, Ashby or Lever link to import the whole posting, or fill in the basics.">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <label className="block space-y-1.5">
            <span className="eyebrow-label">Posting link</span>
            <Input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://boards.greenhouse.io/…" />
          </label>
          {ref ? (
            <p className="rounded-md bg-success/10 px-3 py-2 text-[13px] text-success">
              {ref.ats[0].toUpperCase() + ref.ats.slice(1)} posting on <b>{ref.board}</b>. Title, location, pay and text will be imported.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1.5"><span className="eyebrow-label">Company</span><Input value={company} onChange={(e) => setCompany(e.target.value)} required={!ref} /></label>
              <label className="space-y-1.5"><span className="eyebrow-label">Title</span><Input value={title} onChange={(e) => setTitle(e.target.value)} required={!ref} /></label>
              <label className="space-y-1.5"><span className="eyebrow-label">Location</span><Input value={location} onChange={(e) => setLocation(e.target.value)} /></label>
              <label className="space-y-1.5"><span className="eyebrow-label">Pay</span><Input value={pay} onChange={(e) => setPay(e.target.value)} placeholder="$180k–$220k" /></label>
            </div>
          )}
          {error && <p className="text-[13px] text-danger">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="gold" disabled={busy || (!ref && (!company || !title))}>
              {busy && <Loader2 className="animate-spin" />} Add to the log
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
