import { useEffect, useState } from 'react';

export type Runtime = 'browser' | 'pwa' | 'electron' | 'tauri' | 'capacitor';

export interface InstallState {
  /** A `beforeinstallprompt` event is waiting, so the app can be installed. */
  canInstall: boolean;
  /** Running as an installed app rather than a browser tab. */
  installed: boolean;
  runtime: Runtime;
  /** iOS Safari cannot fire `beforeinstallprompt`; show manual steps instead. */
  showIosHint: boolean;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const isBrowser = typeof window !== 'undefined';
const isStandalone = () =>
  isBrowser &&
  (window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true);

function detectRuntime(): Runtime {
  if (!isBrowser) return 'browser';
  const scope = window as Window & { __TAURI_INTERNALS__?: unknown; Capacitor?: { isNativePlatform?: () => boolean } };
  if (scope.__TAURI_INTERNALS__) return 'tauri';
  if (navigator.userAgent.includes('Electron')) return 'electron';
  if (scope.Capacitor?.isNativePlatform?.()) return 'capacitor';
  return isStandalone() ? 'pwa' : 'browser';
}

function detectIosHint(): boolean {
  if (!isBrowser) return false;
  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return iOS && !isStandalone();
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;

let state: InstallState = {
  canInstall: false,
  installed: isStandalone(),
  runtime: detectRuntime(),
  showIosHint: detectIosHint(),
};

const listeners = new Set<(next: InstallState) => void>();

function emit() {
  for (const listener of listeners) listener(state);
}

function patch(next: Partial<InstallState>) {
  state = { ...state, ...next };
  emit();
}

/**
 * Wires up every platform signal exactly once. Safe to call unconditionally:
 * it no-ops outside a browser.
 */
export function initPlatform(): () => void {
  if (!isBrowser) return () => undefined;

  const cleanups: Array<() => void> = [];

  const onInstallPrompt = (event: Event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    patch({ canInstall: true });
  };
  const onInstalled = () => patch({ canInstall: false, installed: true, runtime: 'pwa' });
  const modeQuery = window.matchMedia('(display-mode: standalone)');
  const onModeChange = () => patch({ installed: isStandalone(), runtime: detectRuntime() });

  window.addEventListener('beforeinstallprompt', onInstallPrompt);
  window.addEventListener('appinstalled', onInstalled);
  modeQuery.addEventListener?.('change', onModeChange);
  cleanups.push(() => window.removeEventListener('beforeinstallprompt', onInstallPrompt));
  cleanups.push(() => window.removeEventListener('appinstalled', onInstalled));
  cleanups.push(() => modeQuery.removeEventListener?.('change', onModeChange));

  // The service worker is for the static web build only. Wrapper runtimes
  // (Electron/Tauri/Capacitor) serve their own bundled files and some of them
  // cannot register workers at all, so they are skipped deliberately.
  const runtime = detectRuntime();
  if (import.meta.env.PROD && runtime === 'browser' && 'serviceWorker' in navigator) {
    void navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  }

  return () => cleanups.forEach((fn) => fn());
}

export function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferredPrompt;
  if (!event) return Promise.resolve('unavailable');
  return event
    .prompt()
    .then(() => event.userChoice)
    .then((choice) => {
      deferredPrompt = null;
      patch({ canInstall: false });
      return choice.outcome;
    })
    .catch(() => 'dismissed' as const);
}

/** Deep link used by the manifest shortcuts (`?action=create|join`). */
export function launchAction(): 'create' | 'join' | null {
  if (!isBrowser) return null;
  const action = new URLSearchParams(window.location.search).get('action');
  return action === 'create' || action === 'join' ? action : null;
}

export function useInstallState(): InstallState {
  const [value, setValue] = useState(state);
  useEffect(() => {
    listeners.add(setValue);
    setValue(state);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return value;
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(isBrowser ? navigator.onLine : true);
  useEffect(() => {
    if (!isBrowser) return undefined;
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}
