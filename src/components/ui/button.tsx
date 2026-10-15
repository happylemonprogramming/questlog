import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const variants = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm',
  lemon: 'bg-lemon text-lemon-foreground hover:brightness-95 shadow-sm',
  outline: 'border border-input bg-surface hover:bg-accent',
  ghost: 'hover:bg-accent text-foreground',
  subtle: 'bg-muted hover:bg-accent text-foreground',
  danger: 'text-danger hover:bg-danger/10',
};
const sizes = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-md',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-lg',
  icon: 'h-8 w-8 rounded-md',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant = 'outline', size = 'md', ...props }, ref) => (
  <button
    ref={ref}
    className={cn(
      'inline-flex shrink-0 items-center justify-center whitespace-nowrap font-medium transition-[background,color,filter,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
      variants[variant],
      sizes[size],
      className,
    )}
    {...props}
  />
));
Button.displayName = 'Button';
