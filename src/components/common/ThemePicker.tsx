import { useEffect, useRef, useState } from 'react';
import { useOpenCall } from '../../contexts/OpenCallContext';
import { ACCENTS, THEMES } from '../../modules/platform/ThemeManager';
import { Icon, IconButton, Toggle } from './UI';

/**
 * The skin switch lives on the right of the bar because that is where a glance
 * goes looking for it: one button, then theme, accent and wallpaper.
 */
export function ThemePicker() {
  const { preferences, updatePreferences } = useOpenCall();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <IconButton
        icon="palette"
        label="Change theme"
        active={open}
        onClick={() => setOpen((prev) => !prev)}
      />

      {open ? (
        <div className="theme-menu">
          <p className="label px-1 pb-1.5 pt-1">Theme</p>
          <div className="swatch-row">
            {THEMES.map((theme) => (
              <button
                key={theme.id}
                type="button"
                title={theme.label}
                aria-label={theme.label}
                aria-pressed={preferences.theme === theme.id}
                onClick={() => updatePreferences({ theme: theme.id })}
                className={`swatch ${preferences.theme === theme.id ? 'swatch-on' : ''}`}
                style={{ background: theme.preview[1] }}
              >
                <span className="h-4 w-4 rounded-full" style={{ background: theme.preview[2] }} />
              </button>
            ))}
          </div>

          <p className="label px-1 pb-1.5 pt-3">Accent</p>
          <div className="swatch-row">
            {ACCENTS.map((accent) => (
              <button
                key={accent.id}
                type="button"
                title={accent.label}
                aria-label={`Accent ${accent.label}`}
                aria-pressed={preferences.accent === accent.id}
                onClick={() => updatePreferences({ accent: accent.id })}
                className={`swatch ${preferences.accent === accent.id ? 'swatch-on' : ''}`}
                style={{ background: accent.color || 'transparent' }}
              >
                {accent.color ? null : <Icon name="brush" className="h-4 w-4 text-ink-400" />}
              </button>
            ))}
          </div>

          <div className="mt-1 border-t border-ink-800 px-1 pt-1">
            <Toggle
              checked={preferences.wallpaper}
              onChange={(next) => updatePreferences({ wallpaper: next })}
              label="Chat wallpaper"
              hint="A faint pattern behind the conversation."
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
