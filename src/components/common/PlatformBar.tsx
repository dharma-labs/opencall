import { useState } from 'react';
import { Button, Icon, Pill } from './UI';
import { promptInstall, useInstallState, useOnline } from '../../modules/platform/PwaManager';

const DISMISS_KEY = 'opencall.install.dismissed';

/** Shown while the device has no network. Nothing in OpenCall needs one. */
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="flex shrink-0 items-center justify-center gap-2 border-b border-warn/25 bg-warn/10 px-3 py-1.5 text-[11px] font-medium text-warn">
      <Icon name="wifi" className="h-3.5 w-3.5" />
      <span>Offline — calls, chat and file transfer still run device to device.</span>
    </div>
  );
}

/** A small, honest label for where the app is running. */
export function RuntimeBadge() {
  const { runtime, installed } = useInstallState();
  if (runtime === 'browser' && !installed) return null;
  const label: Record<string, string> = {
    browser: 'browser',
    pwa: 'installed app',
    electron: 'desktop app',
    tauri: 'desktop app',
    capacitor: 'mobile app',
  };
  return (
    <Pill tone="neutral">
      <Icon name={runtime === 'capacitor' ? 'phone' : runtime === 'browser' ? 'link' : 'monitor'} className="h-3 w-3" />
      {label[runtime] ?? runtime}
    </Pill>
  );
}

/**
 * Offers installation on desktop and mobile. iOS Safari never fires
 * `beforeinstallprompt`, so it gets written instructions instead.
 */
export function InstallPrompt() {
  const { canInstall, installed, showIosHint, runtime } = useInstallState();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });

  if (dismissed || installed || runtime !== 'browser' || (!canInstall && !showIosHint)) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* storage unavailable — the banner simply returns next launch */
    }
  };

  return (
    <div className="mx-3 mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-ink-700 bg-ink-850/70 px-3 py-2.5 lg:mx-4">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-accent/40 bg-accent/10">
        <Icon name="download" className="h-4 w-4 text-accent" />
      </span>
      <span className="min-w-[12rem] flex-1">
        <span className="block text-xs font-medium text-ink-100">Install OpenCall as an app</span>
        <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-400">
          {canInstall
            ? 'Runs in its own window, opens offline, and keeps its own camera and microphone permissions.'
            : 'Tap Share, then “Add to Home Screen” to install it on this device.'}
        </span>
      </span>
      <span className="flex items-center gap-2">
        {canInstall ? (
          <Button size="sm" variant="primary" icon="download" onClick={() => void promptInstall()}>
            Install
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={dismiss}>
          Not now
        </Button>
      </span>
    </div>
  );
}
