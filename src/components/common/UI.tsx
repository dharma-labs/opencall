import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

const ICONS: Record<string, string> = {
  x: 'M18 6L6 18M6 6l12 12',
  check: 'M20 6L9 17l-5-5',
  'check-check': 'M2 12l5 5L17 7M12 15l1.5 1.5L22 8',
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z',
  clip: 'M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48',
  mic: 'M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3zM19 10v2a7 7 0 01-14 0v-2M12 19v4',
  'mic-off': 'M1 1l22 22M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6M19 10v2a7 7 0 01-.11 1.23M5 10v2a7 7 0 0012 0M12 19v4',
  video: 'M23 7l-7 5 7 5V7zM1 5a2 2 0 012-2h11a2 2 0 012 2v14a2 2 0 01-2 2H3a2 2 0 01-2-2V5z',
  'video-off': 'M1 1l22 22M16 16v1a2 2 0 01-2 2H3a2 2 0 01-2-2V7a2 2 0 012-2h2m4 0h5a2 2 0 012 2v5m0 4l7 4V7l-3 2',
  monitor: 'M2 3h20v14H2zM8 21h8M12 17v4',
  phone: 'M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0122 16.92z',
  'phone-plus': 'M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0122 16.92zM19 5v6M22 8h-6',
  'phone-off': 'M1 1l22 22M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45c.91.34 1.85.57 2.81.7a2 2 0 011.72 2v3a2 2 0 01-2.18 2A19.79 19.79 0 011.51 4.18 2 2 0 013.5 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.81a2 2 0 01-.45 2.11l-.8.8',
  camera: 'M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2zM12 17a4 4 0 100-8 4 4 0 000 8z',
  'camera-flip': 'M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2zM9 13a3 3 0 005.5 1.5M15 13a3 3 0 00-5.5-1.5M15 9v2h-2M9 17v-2h2',
  qr: 'M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h2v2h-2zM19 15h2v2h-2zM15 19h2v2h-2zM19 19h2v2h-2z',
  copy: 'M20 9h-9a2 2 0 00-2 2v9a2 2 0 002 2h9a2 2 0 002-2v-9a2 2 0 00-2-2zM5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1',
  download: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3',
  upload: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12',
  refresh: 'M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  home: 'M3 11l9-7.5 9 7.5M5.5 9.8V20a1 1 0 001 1H10v-6h4v6h3.5a1 1 0 001-1V9.8',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 018 0v4',
  users: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 7a4 4 0 100 8 4 4 0 000-8zM23 21v-2a4 4 0 00-3-3.87',
  alert: 'M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01',
  clock: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 6v6l4 2',
  file: 'M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9zM13 2v7h7',
  image: 'M3 3h18v18H3zM8.5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM21 15l-5-5L5 21',
  trash: 'M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6',
  reply: 'M9 17l-5-5 5-5M20 18v-2a4 4 0 00-4-4H4',
  link: 'M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71',
  wifi: 'M5 12.55a11 11 0 0114.08 0M1.42 9a16 16 0 0121.16 0M8.53 16.11a6 6 0 016.95 0M12 20h.01',
  'chevron-left': 'M15 18l-6-6 6-6',
  'chevron-right': 'M9 18l6-6-6-6',
  plus: 'M12 5v14M5 12h14',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  spinner: 'M21 12a9 9 0 11-6.219-8.56',
  'arrow-right': 'M5 12h14M12 5l7 7-7 7',
  smile: 'M12 22a10 10 0 100-20 10 10 0 000 20zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01',
  maximize: 'M8 3H5a2 2 0 00-2 2v3M16 3h3a2 2 0 012 2v3M16 21h3a2 2 0 002-2v-3M8 21H5a2 2 0 01-2-2v-3',
  power: 'M18.36 6.64a9 9 0 11-12.73 0M12 2v10',
  info: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 16v-4M12 8h.01',
  key: 'M15.5 7.5l3 3L22 7l-3-3M13.39 9.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777l6.61-6.61',
  palette: 'M12 22a10 10 0 110-20c4.97 0 9 3.58 9 8 0 2.5-2 4-4 4h-1.5a2 2 0 00-1.6 3.2 2 2 0 01-1.9 2.8zM7.5 10a1 1 0 100-2 1 1 0 000 2zM12 7.5a1 1 0 100-2 1 1 0 000 2zM16.5 10a1 1 0 100-2 1 1 0 000 2z',
  brush: 'M9.06 11.9l3.07 3.06a2 2 0 11-2.83 2.83l-3.4 1.41a4 4 0 01-2.2-5.2l1.41-3.4a2 2 0 112.83 2.83zM20.71 4.63l-1.34-1.34a1 1 0 00-1.42 0l-6.06 6.06a1 1 0 000 1.42l1.34 1.34a1 1 0 001.42 0l6.06-6.06a1 1 0 000-1.42z',
  moon: 'M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z',
  sun: 'M12 17a5 5 0 100-10 5 5 0 000 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  more: 'M12 13a1 1 0 100-2 1 1 0 000 2zM19 13a1 1 0 100-2 1 1 0 000 2zM5 13a1 1 0 100-2 1 1 0 000 2z',
  'menu-down': 'M6 9l6 6 6-6',
  chat: 'M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z',
};

export type IconName = keyof typeof ICONS;

export function Icon({ name, className = 'h-4 w-4', filled = false }: { name: string; className?: string; filled?: boolean }) {
  const path = ICONS[name] ?? ICONS.info;
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={filled ? 1.6 : 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  size?: 'md' | 'sm';
  icon?: string;
};

export function Button({ variant = 'default', size = 'md', icon, className = '', children, ...rest }: ButtonProps) {
  const variants = {
    default: 'btn',
    primary: 'btn btn-primary',
    ghost: 'btn btn-ghost',
    danger: 'btn btn-danger',
  } as const;
  return (
    <button type="button" className={`${variants[variant]} ${size === 'sm' ? 'btn-sm' : ''} ${className}`} {...rest}>
      {icon ? <Icon name={icon} className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  className = '',
  active = false,
  label,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; active?: boolean; label: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`icon-btn ${active ? 'icon-btn-on' : ''} ${className}`}
      {...rest}
    >
      <Icon name={icon} className="h-4 w-4" />
    </button>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2">
      <span className="min-w-0">
        <span className="block text-sm text-ink-100">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs leading-relaxed text-ink-400">{hint}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors ${
          checked ? 'border-accent/60 bg-accent/70' : 'border-ink-600 bg-ink-800'
        }`}
      >
        <span
          className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-ink-100 transition-all ${
            checked ? 'left-[18px]' : 'left-0.5'
          }`}
        />
      </button>
    </label>
  );
}

export function Pill({
  tone = 'neutral',
  children,
  dot = false,
}: {
  tone?: 'neutral' | 'ok' | 'warn' | 'bad' | 'accent';
  children: ReactNode;
  dot?: boolean;
}) {
  const tones = {
    neutral: 'border-ink-700 bg-ink-850 text-ink-300',
    ok: 'border-ok/30 bg-ok/10 text-ok',
    warn: 'border-warn/30 bg-warn/10 text-warn',
    bad: 'border-bad/30 bg-bad/10 text-bad',
    accent: 'border-accent/40 bg-accent/10 text-accent',
  } as const;
  const dots = {
    neutral: 'bg-ink-400',
    ok: 'bg-ok',
    warn: 'bg-warn',
    bad: 'bg-bad',
    accent: 'bg-accent',
  } as const;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${tones[tone]}`}>
      {dot ? <span className={`h-1.5 w-1.5 rounded-full ${dots[tone]}`} /> : null}
      {children}
    </span>
  );
}

export function Modal({ open, onClose, title, children, wide = false }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 p-4" role="dialog" aria-modal="true">
      <div className={`panel w-full ${wide ? 'max-w-2xl' : 'max-w-md'} animate-fade-in p-4`}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-100">{title}</h2>
          <IconButton icon="x" label="Close" onClick={onClose} />
        </div>
        {children}
      </div>
    </div>
  );
}

export function ProgressBar({ value, max, tone = 'accent' }: { value: number; max: number; tone?: 'accent' | 'ok' | 'bad' }) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const tones = { accent: 'bg-accent', ok: 'bg-ok', bad: 'bg-bad' } as const;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-800">
      <div className={`h-full rounded-full ${tones[tone]} transition-[width] duration-200`} style={{ width: `${percent}%` }} />
    </div>
  );
}

export function CopyField({ value, label, rows = 3, onCopied }: { value: string; label: string; rows?: number; onCopied?: () => void }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const area = document.createElement('textarea');
        area.value = value;
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        area.remove();
      }
      setCopied(true);
      onCopied?.();
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="label">{label}</span>
        <Button size="sm" variant="ghost" icon={copied ? 'check' : 'copy'} onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <textarea readOnly value={value} rows={rows} className="input resize-none font-mono text-[11px] leading-relaxed" onFocus={(event) => event.currentTarget.select()} />
    </div>
  );
}

export function Empty({ icon = 'info', title, hint }: { icon?: string; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <Icon name={icon} className="h-6 w-6 text-ink-500" />
      <p className="text-sm text-ink-200">{title}</p>
      {hint ? <p className="max-w-sm text-xs leading-relaxed text-ink-400">{hint}</p> : null}
    </div>
  );
}
