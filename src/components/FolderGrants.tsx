import { useEffect, useState } from 'react';
import { Folder, FolderPlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { desktop } from '@/lib/desktop';

/**
 * The folders on this computer the agent may read, for building a resume from
 * your projects and commits. Folders are only ever added by picking them here
 * or when the agent asks; the agent can't add one itself.
 */
export function FolderGrants() {
  const [folders, setFolders] = useState<string[] | null>(null);
  const local = desktop()?.local;

  useEffect(() => {
    void local?.grants().then(setFolders);
  }, [local]);

  if (!local) return null;

  const add = async () => {
    const res = await local.grant();
    if (res) setFolders(res.grants);
  };

  return (
    <div className="space-y-2">
      {folders?.length ? (
        <ul className="divide-y rounded-2xl border">
          {folders.map((f) => (
            <li key={f} className="flex items-center gap-3 px-3.5 py-2.5">
              <Folder className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]" title={f}>{f}</span>
              <Button variant="danger" size="sm" onClick={async () => setFolders(await local.revoke(f))}>
                <X /> Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        folders && <p className="text-[12.5px] text-muted-foreground">No folders shared. The agent can't see any of your files.</p>
      )}
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={add}>
          <FolderPlus /> Add a folder
        </Button>
        <span className="text-[12px] text-muted-foreground">Read only. Secrets like .env files and keys, dependencies and build output are always skipped.</span>
      </div>
    </div>
  );
}
