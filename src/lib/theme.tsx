import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'system' | 'light' | 'dark';
const KEY = 'questlog:theme';

const Ctx = createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({ theme: 'system', setTheme: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem(KEY) as Theme) || 'system');

  useEffect(() => {
    localStorage.setItem(KEY, theme);
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => document.documentElement.classList.toggle('dark', theme === 'dark' || (theme === 'system' && mq.matches));
    apply();
    if (theme !== 'system') return;
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  return <Ctx.Provider value={{ theme, setTheme }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
