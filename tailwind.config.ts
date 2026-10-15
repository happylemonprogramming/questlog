import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';
import typography from '@tailwindcss/typography';

const hsl = (v: string) => `hsl(var(--${v}) / <alpha-value>)`;

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter Variable"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', 'ui-monospace', 'monospace'],
      },
      colors: {
        border: hsl('border'),
        input: hsl('input'),
        ring: hsl('ring'),
        background: hsl('background'),
        foreground: hsl('foreground'),
        surface: hsl('surface'),
        sunken: hsl('sunken'),
        primary: { DEFAULT: hsl('primary'), foreground: hsl('primary-foreground') },
        muted: { DEFAULT: hsl('muted'), foreground: hsl('muted-foreground') },
        accent: { DEFAULT: hsl('accent'), foreground: hsl('accent-foreground') },
        lemon: { DEFAULT: hsl('lemon'), foreground: hsl('lemon-foreground'), soft: hsl('lemon-soft') },
        success: hsl('success'),
        warning: hsl('warning'),
        danger: hsl('danger'),
        info: hsl('info'),
        violet: hsl('violet'),
      },
      borderRadius: { lg: 'var(--radius)', md: 'calc(var(--radius) - 2px)', sm: 'calc(var(--radius) - 4px)' },
      boxShadow: {
        soft: '0 1px 2px hsl(var(--shadow) / 0.06), 0 4px 16px -4px hsl(var(--shadow) / 0.08)',
        lift: '0 2px 4px hsl(var(--shadow) / 0.06), 0 12px 32px -8px hsl(var(--shadow) / 0.16)',
      },
    },
  },
  plugins: [animate, typography],
} satisfies Config;
