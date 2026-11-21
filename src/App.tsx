import { useEffect, useRef, useState } from 'react';
import { OpenCallProvider, useOpenCall } from './contexts/OpenCallContext';
import { Landing } from './components/landing/Landing';
import { LinkConnect } from './components/connection/LinkConnect';
import { ConnectionSetup } from './components/connection/ConnectionSetup';
import { ChatPanel } from './components/chat/ChatPanel';
import { CallOverlay } from './components/calling/CallOverlay';
import { SessionSidebar } from './components/session/SessionSidebar';
import { SidePanel } from './components/diagnostics/SidePanel';
import { HistoryView } from './components/history/HistoryView';
import { SettingsView } from './components/settings/SettingsView';
import { ThemePicker } from './components/common/ThemePicker';
import { Button, Icon, IconButton, Pill } from './components/common/UI';
import { InstallPrompt, OfflineBanner } from './components/common/PlatformBar';
import { launchAction } from './modules/platform/PwaManager';
import { decodeSignal, readShareLink } from './modules/connection/SignalingManager';
import { AppMark, Splash } from './components/common/Splash';
import type { Tab } from './types';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'home', label: 'Chats', icon: 'chat' },
  { id: 'history', label: 'History', icon: 'clock' },
  { id: 'settings', label: 'Settings', icon: 'sliders' },
];

/**
 * Honours the app-shortcut deep links from the web manifest
 * (`?action=create` / `?action=join`) so an installed OpenCall can open
 * straight into a handshake.
 */
function LaunchHandler() {
  const { phase, startLink } = useOpenCall();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current || phase !== 'landing') return;
    if (launchAction() !== 'create') return;
    handled.current = true;
    void startLink();
  }, [phase, startLink]);

  return null;
}

/**
 * Accepts a hand-passed invite (`…#oc=…`) from the no-server mode. The link
 * itself is handled by the context, which opens the room straight from `#r=`.
 */
function ShareLinkHandler() {
  const { startGuest, submitGuestData, completeAsHost } = useOpenCall();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    const payload = readShareLink(window.location.hash);
    if (!payload) return;
    handled.current = true;

    void (async () => {
      try {
        const signal = await decodeSignal(payload);
        if (signal.kind === 'offer') {
          startGuest();
          await submitGuestData(payload);
        } else {
          await completeAsHost(payload);
        }
      } catch {
        // A truncated or stale link simply leaves the user on the landing
        // screen, where they can scan or paste instead.
      }
      try {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      } catch {
        /* history is unavailable in some wrapper runtimes */
      }
    })();
  }, [completeAsHost, startGuest, submitGuestData]);

  return null;
}

function StatusPill() {
  const { status } = useOpenCall();
  if (status === 'idle') return null;
  const label: Record<string, string> = {
    preparing: 'Opening',
    'awaiting-peer': 'Waiting',
    connecting: 'Connecting',
    connected: 'Connected',
    degraded: 'Reconnecting',
    disconnected: 'Offline',
    failed: 'Failed',
  };
  const tone = status === 'connected' ? 'ok' : status === 'failed' ? 'bad' : 'warn';
  return (
    <Pill tone={tone} dot>
      {label[status] ?? status}
    </Pill>
  );
}

function SectionTabs({ tab, onTab, className = '' }: { tab: Tab; onTab: (next: Tab) => void; className?: string }) {
  return (
    <nav className={`tabs ${className}`} aria-label="Sections">
      {TABS.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onTab(item.id)}
          aria-current={tab === item.id ? 'page' : undefined}
          className={`tab ${tab === item.id ? 'tab-on' : ''}`}
        >
          <Icon name={item.icon} className="h-3.5 w-3.5" />
          {item.label}
        </button>
      ))}
    </nav>
  );
}

function BottomNav({ tab, onTab }: { tab: Tab; onTab: (next: Tab) => void }) {
  return (
    <nav className="bottom-nav" aria-label="Sections">
      {TABS.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onTab(item.id)}
          aria-current={tab === item.id ? 'page' : undefined}
          className={`nav-item ${tab === item.id ? 'nav-item-on' : ''}`}
        >
          <Icon name={item.icon} className="h-5 w-5" />
          {item.label}
        </button>
      ))}
    </nav>
  );
}

/** The thread: chat when it is live, the link while it opens, a landing otherwise. */
function MainPane() {
  const { phase } = useOpenCall();

  if (phase === 'session') return <Session />;
  if (phase === 'link') return <LinkConnect />;
  if (phase === 'landing') return <Landing />;
  return <ConnectionSetup />;
}

function Session() {
  const { disconnect, call } = useOpenCall();
  const [panelOpen, setPanelOpen] = useState(false);

  return (
    <>
      <ChatPanel />
      <div className="hidden xl:flex">
        <SidePanel />
      </div>
      {panelOpen ? (
        <div className="fixed inset-0 z-30 flex bg-ink-950/80 p-3 backdrop-blur-sm">
          <SidePanel onClose={() => setPanelOpen(false)} />
        </div>
      ) : null}

      {/* Phones keep one row of session controls under the composer. */}
      <div className="flex items-center justify-end gap-2 px-3 pb-2 lg:hidden">
        <Button size="sm" icon="activity" onClick={() => setPanelOpen(true)}>
          Details
        </Button>
        <Button size="sm" variant="danger" icon="power" onClick={disconnect} disabled={call.active}>
          End
        </Button>
      </div>
    </>
  );
}

function Shell() {
  const { phase, disconnect, safetyCode, encryptionReady, call, startLink } = useOpenCall();
  const [tab, setTab] = useState<Tab>('home');
  const inSession = phase === 'session';
  const handshaking = phase !== 'landing' && phase !== 'session';

  // Whatever the user just started — a link or a live chat — belongs on Chats.
  useEffect(() => {
    if (handshaking || inSession) setTab('home');
  }, [handshaking, inSession]);

  const recall = (session: string) => void startLink(session);

  return (
    <div className="flex h-full flex-col">
      <OfflineBanner />

      <header className="navbar">
        <div className="navbar-row">
          <div className="flex min-w-0 items-center gap-2.5 sm:flex-none">
            <AppMark size="sm" />
            <span className="hidden truncate text-sm font-semibold tracking-tight text-ink-100 sm:inline">
              OpenCall
            </span>
          </div>

          <div className="flex flex-1 items-center justify-center gap-2">
            <SectionTabs tab={tab} onTab={setTab} className="hidden sm:flex" />
            <StatusPill />
          </div>

          <div className="flex items-center justify-end gap-1.5 sm:flex-none sm:gap-2">
            {inSession && encryptionReady && safetyCode ? (
              <span
                className="mono hidden text-ink-500 2xl:inline"
                title="Compare this safety code with the other device"
              >
                {safetyCode}
              </span>
            ) : null}
            {inSession ? (
              <IconButton
                icon="power"
                label="End session"
                onClick={disconnect}
                disabled={call.active}
                className="hidden sm:inline-flex"
              />
            ) : null}
            <ThemePicker />
          </div>
        </div>
      </header>

      <main className="app-grid">
        {tab === 'home' ? (
          <>
            <div className="hidden lg:flex">
              <SessionSidebar onRecall={recall} />
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              <MainPane />
            </div>
          </>
        ) : null}
        {tab === 'history' ? <HistoryView onConnect={() => setTab('home')} /> : null}
        {tab === 'settings' ? <SettingsView /> : null}
      </main>

      {inSession ? <CallOverlay /> : null}
      {phase === 'landing' && tab === 'home' ? <InstallPrompt /> : null}
      <BottomNav tab={tab} onTab={setTab} />
    </div>
  );
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [hiding, setHiding] = useState(false);

  // The launch screen is held until the first paint and the webfonts are in, so
  // the app never flashes a half-drawn layout.
  useEffect(() => {
    const started = Date.now();
    let timer = window.setTimeout(() => undefined, 0);

    const release = () => {
      window.clearTimeout(timer);
      const remaining = Math.max(0, 900 - (Date.now() - started));
      timer = window.setTimeout(() => {
        setHiding(true);
        timer = window.setTimeout(() => setBooting(false), 520);
      }, remaining);
    };

    if (document.fonts?.ready) void document.fonts.ready.then(release).catch(release);
    else release();

    return () => window.clearTimeout(timer);
  }, []);

  return (
    <OpenCallProvider>
      <LaunchHandler />
      <ShareLinkHandler />
      <Shell />
      {booting ? <Splash hiding={hiding} /> : null}
    </OpenCallProvider>
  );
}
