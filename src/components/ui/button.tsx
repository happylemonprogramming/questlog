import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const variants = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm',
  gold: 'shine bg-gold text-gold-foreground shadow-[0_6px_20px_-8px_hsl(var(--gold)/0.7)] hover:shadow-[0_8px_26px_-8px_hsl(var(--gold)/0.9)]',
  outline: 'border border-input/80 bg-surface/80 hover:border-foreground/20 hover:bg-accent',
  ghost: 'hover:bg-accent text-foreground',
  subtle: 'bg-muted hover:bg-accent text-foreground',
  danger: 'text-danger hover:bg-danger/10',
};
const sizes = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-md',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-5 text-[14.5px] gap-2 rounded-xl',
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
      'inline-flex shrink-0 items-center justify-center whitespace-nowrap font-medium transition-[background,color,filter,box-shadow,transform,border-color] duration-200 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
      variants[variant],
      sizes[size],
      className,
    )}
    {...props}
  />
));
Button.displayName = 'Button';
