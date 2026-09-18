'use client';
import { useState, useEffect } from 'react';
import { Sun, Moon } from 'lucide-react';

type Theme = 'light' | 'dark';

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  localStorage.setItem('theme', theme);
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('dark');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('theme');
    setTheme(stored === 'light' ? 'light' : 'dark');
    setMounted(true);
  }, []);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
  }

  if (!mounted) return null;

  const isDark = theme === 'dark';

  return (
    <label className="flex items-start gap-3 p-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface-muted)] cursor-pointer">
      <button
        type="button"
        onClick={toggle}
        role="switch"
        aria-checked={isDark}
        className={`mt-0.5 relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${isDark ? 'bg-[#1662dd]' : 'bg-slate-300'}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white flex items-center justify-center transition-transform ${isDark ? 'translate-x-4' : ''}`}
        >
          {isDark ? <Moon className="w-2.5 h-2.5 text-[#1662dd]" /> : <Sun className="w-2.5 h-2.5 text-amber-500" />}
        </span>
      </button>
      <div onClick={toggle}>
        <div className="text-sm font-semibold text-[var(--text-primary)]">Dark mode</div>
        <div className="text-xs text-[var(--text-secondary)] mt-0.5">
          Switch the dashboard between light and dark themes. Saved on this device only.
        </div>
      </div>
    </label>
  );
}
