import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight, CalendarClock, FileText, Layers, NotebookPen, Rocket, Send, Trophy, Users } from 'lucide-react';
import { Markdown } from '@/components/Markdown';
import { db, getProfile } from '@/lib/db';
import { Card, CardHeader, Empty, JobRow, PageHeader } from '@/components/common';
import { AddJobButton } from '@/components/AddJob';
import { Badge } from '@/components/ui/badge';
import type { Job } from '@/lib/types';
import { cn, timeAgo } from '@/lib/utils';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function Stat({ label, value, icon, tone, to }: { label: string; value: number; icon: React.ReactNode; tone: string; to: string }) {
  return (
    <Link to={to} className="group rounded-2xl border bg-surface p-4 shadow-soft transition hover:-translate-y-0.5 hover:shadow-lift">
      <div className={cn('mb-3 grid size-8 place-items-center rounded-lg [&_svg]:size-4', tone)}>{icon}</div>
      <p className="font-mono text-[26px] font-semibold leading-none tracking-tight">{value}</p>
      <p className="mt-1.5 text-[13px] text-muted-foreground">{label}</p>
    </Link>
  );
}

export default function Today() {
  const profile = useLiveQuery(() => getProfile(), []);
  const jobs = useLiveQuery(() => db.jobs.toArray(), []) ?? [];
  const docs = useLiveQuery(() => db.docs.orderBy('updatedAt').reverse().limit(5).toArray(), []) ?? [];

  const next = jobs.filter((j) => j.stage === 'next');
  const batches = new Map<string, Job[]>();
  for (const j of next) {
    const k = j.batch || 'Unbatched';
    batches.set(k, [...(batches.get(k) ?? []), j]);
  }
  const moonshots = jobs.filter((j) => j.moonshot && j.stage !== 'closed').sort((a, b) => (a.moonshotRank ?? 99) - (b.moonshotRank ?? 99)).slice(0, 5);
  const activity = jobs
    .flatMap((j) => (j.log ?? []).map((l) => ({ ...l, job: j })))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 6);
  const count = (s: Job['stage']) => jobs.filter((j) => j.stage === s).length;
  const first = profile?.name?.split(' ')[0];

  return (
    <>
      <PageHeader
        eyebrow={new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        title={`${greeting()}${first ? `, ${first}` : ''}`}
        sub={next.length ? `${next.length} ${next.length === 1 ? 'role is' : 'roles are'} lined up to apply to.` : 'Nothing is lined up yet. Move a listing to “Next up” to plan your next applications.'}
      >
        <AddJobButton />
      </PageHeader>

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Next up" value={count('next')} icon={<CalendarClock />} tone="bg-lemon-soft text-foreground ring-1 ring-lemon/50" to="/pipeline" />
        <Stat label="Applied" value={count('applied')} icon={<Send />} tone="bg-info/12 text-info" to="/pipeline" />
        <Stat label="Interviewing" value={count('interviewing')} icon={<Users />} tone="bg-violet/12 text-violet" to="/pipeline" />
        <Stat label="Offers" value={count('offer')} icon={<Trophy />} tone="bg-success/12 text-success" to="/pipeline" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader title="Next up" icon={<CalendarClock />} count={next.length} action={<Link to="/listings" className="text-[12.5px] text-muted-foreground hover:text-foreground">All listings</Link>} />
          <div className="px-2 pb-3">
            {next.length === 0 ? (
              <div className="p-3"><Empty icon={<CalendarClock />} title="No applications planned">Open a listing and set its stage to Next up, or ask the assistant what to apply to.</Empty></div>
            ) : (
              [...batches].map(([batch, list]) => (
                <div key={batch} className="mt-2 first:mt-0">
                  <div className="flex items-center gap-2 px-3 pb-1 pt-2">
                    <Layers className="size-3.5 text-muted-foreground" />
                    <p className="eyebrow-label">{batch}</p>
                    <span className="h-px flex-1 bg-border" />
                    <span className="font-mono text-[11px] text-muted-foreground">{list.length}</span>
                  </div>
                  {list.map((j) => <JobRow key={j.id} job={j} right={<span />} />)}
                </div>
              ))
            )}
          </div>
        </Card>

        <div className="space-y-6">
          {profile?.notes?.trim() && (
            <Card>
              <CardHeader title="Working notes" icon={<NotebookPen />} action={<Link to="/settings" className="text-[12.5px] text-muted-foreground hover:text-foreground">Edit</Link>} />
              <div className="scroll-thin max-h-[340px] overflow-y-auto px-5 pb-4">
                <Markdown text={profile.notes} />
              </div>
            </Card>
          )}
          <Card>
            <CardHeader title="Moonshots" icon={<Rocket />} action={<Link to="/moonshots" className="text-muted-foreground hover:text-foreground"><ArrowRight className="size-4" /></Link>} />
            <div className="px-2 pb-3">
              {moonshots.length ? moonshots.map((j, i) => (
                <JobRow key={j.id} job={j} compact right={j.stage === 'applied' ? <Badge tone="info">Applied</Badge> : <span />} rank={<span className="w-4 text-center font-mono text-[12px] text-muted-foreground">{i + 1}</span>} />
              )) : <p className="px-3 py-4 text-[13px] text-muted-foreground">Long shots worth a try will show up here.</p>}
            </div>
          </Card>

          <Card>
            <CardHeader title="Recent documents" icon={<FileText />} action={<Link to="/documents" className="text-muted-foreground hover:text-foreground"><ArrowRight className="size-4" /></Link>} />
            <div className="px-2 pb-3">
              {docs.map((d) => (
                <Link key={d.id} to={`/documents/${d.id}`} className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-accent/70">
                  <div className="grid h-9 w-7 shrink-0 place-items-center rounded-[4px] border bg-background shadow-sm">
                    <span className="h-0.5 w-3 rounded bg-lemon" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium">{d.title}</p>
                    <p className="text-[12px] capitalize text-muted-foreground">{d.kind} · {timeAgo(d.updatedAt)}</p>
                  </div>
                </Link>
              ))}
            </div>
          </Card>

          {activity.length > 0 && (
            <Card>
              <CardHeader title="Activity" />
              <ol className="relative mx-5 mb-4 space-y-3 border-l pl-4">
                {activity.map((a, i) => (
                  <li key={i} className="relative text-[13px]">
                    <span className="absolute -left-[21px] top-1.5 size-2 rounded-full border-2 border-surface bg-muted-foreground/50" />
                    <Link to={`/jobs/${encodeURIComponent(a.job.id)}`} className="font-medium hover:underline">{a.job.company}</Link>
                    <span className="text-muted-foreground">: {a.text}</span>
                    <p className="font-mono text-[11px] text-muted-foreground">{a.at}</p>
                  </li>
                ))}
              </ol>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
