import type { AccentId, ThemeId } from '../../types';

export interface ThemeInfo {
  id: ThemeId;
  label: string;
  /** [page, surface, accent] swatch colours for the picker. */
  preview: [string, string, string];
  dark: boolean;
  /** Painted into the browser chrome and the native status bar. */
  browserColor: string;
}

export const THEMES: ThemeInfo[] = [
  { id: 'midnight', label: 'Midnight', preview: ['#08080c', '#191922', '#4ca0ff'], dark: true, browserColor: '#08080c' },
  { id: 'dark', label: 'OLED', preview: ['#000000', '#151519', '#60a5fa'], dark: true, browserColor: '#000000' },
  { id: 'light', label: 'Daylight', preview: ['#f4f5f8', '#ffffff', '#2563eb'], dark: false, browserColor: '#f4f5f8' },
  { id: 'whatsapp', label: 'Messenger', preview: ['#0a1014', '#111b21', '#00a884'], dark: true, browserColor: '#0a1014' },
  { id: 'letsfi', label: 'LetsFi', preview: ['#060a14', '#0a101e', '#22d3ee'], dark: true, browserColor: '#060a14' },
  { id: 'galib', label: 'Galib', preview: ['#0e0c0a', '#14110e', '#f59e0b'], dark: true, browserColor: '#0e0c0a' },
];

export const ACCENTS: { id: AccentId; label: string; color: string }[] = [
  { id: 'auto', label: 'Theme', color: '' },
  { id: 'blue', label: 'Blue', color: '#4ca0ff' },
  { id: 'green', label: 'Green', color: '#30d158' },
  { id: 'teal', label: 'Teal', color: '#14b8a6' },
  { id: 'amber', label: 'Amber', color: '#f59e0b' },
  { id: 'violet', label: 'Violet', color: '#8b5cf6' },
  { id: 'rose', label: 'Rose', color: '#f43f5e' },
];

export function themeInfo(id: ThemeId): ThemeInfo {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}

/** Writes the skin onto <html> and keeps the browser chrome matching. */
export function applyTheme(theme: ThemeId, accent: AccentId, wallpaper: boolean): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.accent = accent;
  root.dataset.wallpaper = wallpaper ? 'on' : 'off';
  root.style.colorScheme = themeInfo(theme).dark ? 'dark' : 'light';

  const color = themeInfo(theme).browserColor;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = color;
}
