import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CheckCircle2, FileArchive, FileCode2, FileText, FileX2, Trash2 } from 'lucide-react';
import { db } from '@/lib/db';
import { Card, Empty } from '@/components/common';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { SourceFile } from '@/lib/types';
import { cn, timeAgo } from '@/lib/utils';

function icon(f: SourceFile) {
  if (f.text === undefined) return <FileX2 className="text-muted-foreground/60" />;
  if (/\.(tsx?|jsx?|json|csv|py)$/i.test(f.path)) return <FileCode2 className="text-info" />;
  return <FileText className="text-muted-foreground" />;
}

/** Uploaded files, grouped by the upload they came in, so you can see what the assistant read. */
export function Sources() {
  const files = useLiveQuery(() => db.files.toArray(), []) ?? [];
  const [open, setOpen] = useState<SourceFile | null>(null);
  const bundles = [...new Set(files.map((f) => f.bundle))];

  if (!files.length) {
    return <Empty icon={<FileArchive />} title="No uploaded files">Drop a .zip of your job-search folder on Settings → Data and the assistant will read it.</Empty>;
  }

  return (
    <div className="space-y-6">
      {bundles.map((b) => {
        const list = files.filter((f) => f.bundle === b).sort((x, y) => x.path.localeCompare(y.path));
        const used = list.filter((f) => f.status).length;
        return (
          <Card key={b} className="overflow-hidden">
            <div className="flex items-center gap-3 border-b bg-sunken/50 px-4 py-3 sm:px-5">
              <FileArchive className="size-4 text-muted-foreground" />
              <p className="flex-1 truncate text-[13.5px] font-semibold">{b}</p>
              <span className="font-mono text-[11.5px] text-muted-foreground">{used}/{list.length} used · {timeAgo(list[0].createdAt)}</span>
              <Button variant="danger" size="icon" aria-label="Remove upload" onClick={() => db.files.where('bundle').equals(b).delete()}><Trash2 /></Button>
            </div>
            <div className="divide-y divide-border/60">
              {list.map((f) => (
                <button
                  key={f.id}
                  onClick={() => f.text !== undefined && setOpen(f)}
                  className={cn('flex w-full items-center gap-3 px-4 py-2 text-left sm:px-5 [&_svg]:size-4 [&_svg]:shrink-0', f.text !== undefined && 'hover:bg-accent/50')}
                >
                  {icon(f)}
                  <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{f.path}</span>
                  {f.status ? (
                    <span className="flex max-w-[45%] items-center gap-1.5 truncate text-[12px] text-success">
                      <CheckCircle2 className="!size-3.5" />
                      <span className="truncate">{f.status}</span>
                    </span>
                  ) : (
                    <span className="text-[12px] text-muted-foreground">{f.text === undefined ? 'binary' : 'not used yet'}</span>
                  )}
                  <span className="w-14 text-right font-mono text-[11px] text-muted-foreground max-sm:hidden">{Math.ceil(f.size / 1024)} KB</span>
                </button>
              ))}
            </div>
          </Card>
        );
      })}
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)} title={open?.path ?? ''} description={open?.status} className="w-[min(860px,calc(100vw-2rem))]">
        <pre className="scroll-thin max-h-[65vh] overflow-auto whitespace-pre-wrap rounded-xl bg-sunken p-4 font-mono text-[12px] leading-relaxed">{open?.text}</pre>
      </Dialog>
    </div>
  );
}
