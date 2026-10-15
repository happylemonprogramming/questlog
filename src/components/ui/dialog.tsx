import * as D from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Dialog({ open, onOpenChange, title, description, children, className }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <D.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-surface p-6 shadow-lift data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            className,
          )}
        >
          <D.Title className="text-base font-semibold tracking-tight">{title}</D.Title>
          {description && <D.Description className="mt-1 text-sm text-muted-foreground">{description}</D.Description>}
          <div className="mt-5">{children}</div>
          <D.Close className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="size-4" />
          </D.Close>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
