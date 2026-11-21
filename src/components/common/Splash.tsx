/**
 * The OpenCall mark and the launch screen.
 *
 * Both are built from a single idea — a light dot held inside an accent ring on
 * a charcoal tile — so the icon in the browser tab, the home screen, the desktop
 * window and the splash screen are recognisably the same object.
 */

const MARK_SIZES = {
  sm: { tile: 'h-7 w-7 rounded-lg', ring: 'h-3.5 w-3.5 border-2', dot: 'h-1 w-1' },
  md: { tile: 'h-10 w-10 rounded-[13px]', ring: 'h-5 w-5 border-2', dot: 'h-1.5 w-1.5' },
  lg: { tile: 'h-14 w-14 rounded-[18px]', ring: 'h-7 w-7 border-[3px]', dot: 'h-2.5 w-2.5' },
} as const;

export function AppMark({ size = 'md', className = '' }: { size?: keyof typeof MARK_SIZES; className?: string }) {
  const metrics = MARK_SIZES[size];
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center border border-ink-700 bg-ink-900 ${metrics.tile} ${className}`}
    >
      <span className={`absolute rounded-full border-accent/70 ${metrics.ring}`} />
      <span className={`rounded-full bg-ink-100 ${metrics.dot}`} />
    </span>
  );
}

export function Splash({ hiding = false }: { hiding?: boolean }) {
  return (
    <div
      className={`splash ${hiding ? 'splash-hidden' : ''}`}
      role="status"
      aria-live="polite"
      aria-label="OpenCall is starting"
    >
      <div className="relative flex items-center justify-center">
        <span className="splash-halo animate-halo" />
        <AppMark size="lg" className="animate-splash-pop shadow-card" />
      </div>

      <div className="flex flex-col items-center gap-2">
        <span className="text-2xl font-semibold tracking-tight text-ink-100">OpenCall</span>
        <span className="text-[10px] font-medium uppercase tracking-[0.28em] text-ink-500">by Dharmendra</span>
      </div>

      <div className="splash-bar" aria-hidden="true" />
    </div>
  );
}
