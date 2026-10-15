import * as T from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';

export const TooltipProvider = T.Provider;

export function Tip({ label, children, side = 'top' }: { label: ReactNode; children: ReactNode; side?: 'top' | 'right' | 'bottom' | 'left' }) {
  return (
    <T.Root delayDuration={250}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={6} className="z-50 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground shadow-soft animate-in fade-in-0">
          {label}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
