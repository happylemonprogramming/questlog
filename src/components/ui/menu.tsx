import * as M from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;

export function MenuContent({ children, align = 'end', className }: { children: ReactNode; align?: 'start' | 'end' | 'center'; className?: string }) {
  return (
    <M.Portal>
      <M.Content
        align={align}
        sideOffset={6}
        className={cn('panel z-50 min-w-[180px] p-1 shadow-lift data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95', className)}
      >
        {children}
      </M.Content>
    </M.Portal>
  );
}

export function MenuItem({ children, onSelect, danger, active }: { children: ReactNode; onSelect?: () => void; danger?: boolean; active?: boolean }) {
  return (
    <M.Item
      onSelect={onSelect}
      className={cn(
        'flex cursor-default select-none items-center gap-2 rounded-[5px] px-2.5 py-1.5 text-[13px] outline-none data-[highlighted]:bg-gold-soft/60 [&_svg]:size-4 [&_svg]:text-muted-foreground',
        danger && 'text-danger [&_svg]:text-danger',
        active && 'font-medium',
      )}
    >
      {children}
    </M.Item>
  );
}

export const MenuSeparator = () => <M.Separator className="my-1 h-px bg-border" />;
export const MenuLabel = ({ children }: { children: ReactNode }) => <M.Label className="px-2.5 pb-1 pt-1.5 eyebrow-label">{children}</M.Label>;
