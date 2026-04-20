export type ThemeId = 'emerald' | 'blue' | 'purple' | 'amber' | 'rose';
export type ModeId = 'light' | 'dark';

export const themes: Array<{
  id: ThemeId;
  name: string;
  preview: string;
  vars: Record<string, string>;
}> = [
  {
    id: 'emerald',
    name: 'Verde',
    preview: '#059669',
    vars: {
      '--brand-50': '#ecfdf5',
      '--brand-100': '#d1fae5',
      '--brand-300': '#6ee7b7',
      '--brand-500': '#10b981',
      '--brand-600': '#059669',
      '--brand-700': '#047857',
      '--brand-900': '#064e3b'
    }
  },
  {
    id: 'blue',
    name: 'Azul',
    preview: '#2563eb',
    vars: {
      '--brand-50': '#eff6ff',
      '--brand-100': '#dbeafe',
      '--brand-300': '#93c5fd',
      '--brand-500': '#3b82f6',
      '--brand-600': '#2563eb',
      '--brand-700': '#1d4ed8',
      '--brand-900': '#1e3a8a'
    }
  },
  {
    id: 'purple',
    name: 'Roxo',
    preview: '#7c3aed',
    vars: {
      '--brand-50': '#f5f3ff',
      '--brand-100': '#ede9fe',
      '--brand-300': '#c4b5fd',
      '--brand-500': '#8b5cf6',
      '--brand-600': '#7c3aed',
      '--brand-700': '#6d28d9',
      '--brand-900': '#4c1d95'
    }
  },
  {
    id: 'amber',
    name: 'Amarelo',
    preview: '#d97706',
    vars: {
      '--brand-50': '#fffbeb',
      '--brand-100': '#fef3c7',
      '--brand-300': '#fcd34d',
      '--brand-500': '#f59e0b',
      '--brand-600': '#d97706',
      '--brand-700': '#b45309',
      '--brand-900': '#78350f'
    }
  },
  {
    id: 'rose',
    name: 'Rosa',
    preview: '#e11d48',
    vars: {
      '--brand-50': '#fff1f2',
      '--brand-100': '#ffe4e6',
      '--brand-300': '#fda4af',
      '--brand-500': '#f43f5e',
      '--brand-600': '#e11d48',
      '--brand-700': '#be123c',
      '--brand-900': '#881337'
    }
  }
];

const STORAGE_KEY = 'zapmass.theme';
const MODE_KEY = 'zapmass.mode';

export const getSavedTheme = (): ThemeId => {
  const saved = localStorage.getItem(STORAGE_KEY) as ThemeId | null;
  return saved || 'emerald';
};

export const getSavedMode = (): ModeId => {
  const saved = localStorage.getItem(MODE_KEY) as ModeId | null;
  return saved || 'dark';
};

export const applyTheme = (themeId: ThemeId) => {
  const theme = themes.find((item) => item.id === themeId);
  if (!theme) return;
  Object.entries(theme.vars).forEach(([key, value]) => {
    document.documentElement.style.setProperty(key, value);
  });
  document.documentElement.setAttribute('data-theme', themeId);
  localStorage.setItem(STORAGE_KEY, themeId);
};

export const applyMode = (mode: ModeId) => {
  document.documentElement.setAttribute('data-mode', mode);
  localStorage.setItem(MODE_KEY, mode);
};

export const cycleTheme = (current: ThemeId) => {
  const index = themes.findIndex((item) => item.id === current);
  const next = themes[(index + 1) % themes.length]?.id || 'emerald';
  applyTheme(next);
  return next;
};

export const toggleMode = (current: ModeId) => {
  const next: ModeId = current === 'dark' ? 'light' : 'dark';
  applyMode(next);
  return next;
};
