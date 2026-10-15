import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const tones = {
  neutral: 'bg-muted text-muted-foreground',
  lemon: 'bg-lemon-soft text-foreground ring-1 ring-inset ring-lemon/60',
  success: 'bg-success/12 text-success',
  warning: 'bg-warning/12 text-warning',
  danger: 'bg-danger/12 text-danger',
  info: 'bg-info/12 text-info',
  violet: 'bg-violet/12 text-violet',
  outline: 'ring-1 ring-inset ring-border text-muted-foreground',
};

export type Tone = keyof typeof tones;

export function Badge({ tone = 'neutral', className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11.5px] font-medium leading-4 [&_svg]:size-3', tones[tone], className)}
      {...props}
    />
  );
}
