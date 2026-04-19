import { useEffect, useState, useCallback } from 'react';

export function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('supernono.theme') as 'light' | 'dark' | null) ?? 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('supernono.theme', theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((t) => (t === 'light' ? 'dark' : 'light'));
  }, []);

  return { theme, toggle, setTheme };
}
