import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';
import typography from '@tailwindcss/typography';
import containerQueries from '@tailwindcss/container-queries';

const hsl = (v: string) => `hsl(var(--${v}) / <alpha-value>)`;

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter Variable"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', 'ui-monospace', 'monospace'],
        // Quest titles and headings: a book face, like chapter titles in a journal.
        display: ['"Fraunces Variable"', 'ui-serif', 'Georgia', 'serif'],
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
        gold: { DEFAULT: hsl('gold'), foreground: hsl('gold-foreground'), soft: hsl('gold-soft'), ink: hsl('gold-ink') },
        success: hsl('success'),
        warning: hsl('warning'),
        danger: hsl('danger'),
        info: hsl('info'),
        violet: hsl('violet'),
      },
      transitionTimingFunction: { spring: 'cubic-bezier(0.3, 1.3, 0.5, 1)', out: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      borderRadius: { lg: 'var(--radius)', md: 'calc(var(--radius) - 2px)', sm: 'calc(var(--radius) - 4px)' },
      boxShadow: {
        soft: '0 1px 2px hsl(var(--shadow) / 0.06), 0 4px 16px -4px hsl(var(--shadow) / 0.08)',
        lift: '0 2px 4px hsl(var(--shadow) / 0.06), 0 12px 32px -8px hsl(var(--shadow) / 0.16)',
        card: 'inset 0 1px 0 hsl(0 0% 100% / 0.04), 0 1px 2px hsl(var(--shadow) / 0.05), 0 8px 24px -12px hsl(var(--shadow) / 0.12)',
        glow: '0 0 0 1px hsl(var(--gold) / 0.35), 0 10px 40px -12px hsl(var(--gold) / 0.45)',
      },
    },
  },
  plugins: [animate, typography, containerQueries],
} satisfies Config;
