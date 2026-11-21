import { useState } from 'react';
import { useOpenCall } from '../../contexts/OpenCallContext';
import { Icon, Pill } from '../common/UI';

type PanelTab = 'diagnostics' | 'security' | 'log';

const TABS: { id: PanelTab; label: string; icon: string }[] = [
  { id: 'diagnostics', label: 'Network', icon: 'activity' },
  { id: 'security', label: 'Security', icon: 'shield' },
  { id: 'log', label: 'Log', icon: 'info' },
];

function Row({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' | 'bad' }) {
  const colour = tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : tone === 'ok' ? 'text-ok' : 'text-ink-200';
  return (
    <div className="flex items-center justify-between gap-3 border-b border-ink-800/70 py-2 last:border-0">
      <span className="text-[11px] text-ink-400">{label}</span>
      <span className={`mono truncate text-right ${colour}`}>{value}</span>
    </div>
  );
}

export function SidePanel({ onClose }: { onClose?: () => void }) {
  const { diagnostics, safetyCode, encryptionReady, preferences, log, status, remoteStream, peerLabel } = useOpenCall();

  const [tab, setTab] = useState<PanelTab>('diagnostics');

  const bitrate = (value: number | null) => (value === null ? '—' : `${Math.round(value / 1000)} kbps`);

  const candidateTone = diagnostics?.candidateType?.includes('relay')
    ? 'bad'
    : diagnostics?.candidateType?.includes('host')
      ? 'ok'
      : undefined;

  return (
    <aside className="panel flex w-full flex-col overflow-hidden lg:w-80">
      <header className="flex items-center justify-between gap-2 border-b border-ink-800 px-3 py-2.5">
        <div className="seg min-w-0 flex-1">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`seg-btn ${tab === item.id ? 'seg-btn-on' : 'seg-btn-off'}`}
            >
              <Icon name={item.icon} className="h-3.5 w-3.5" />
              {item.label}
            </button>
          ))}
        </div>
        {onClose ? (
          <button
            type="button"
            className="icon-btn icon-btn-plain h-7 w-7 lg:hidden"
            onClick={onClose}
            aria-label="Close panel"
          >
            <Icon name="x" className="h-4 w-4" />
          </button>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {tab === 'diagnostics' ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Pill tone={status === 'connected' ? 'ok' : status === 'failed' ? 'bad' : 'warn'} dot>
                {status}
              </Pill>
              <span className="mono text-ink-500">
                {diagnostics?.updatedAt ? new Date(diagnostics.updatedAt).toLocaleTimeString() : 'waiting'}
              </span>
            </div>
            <Row label="Peer connection" value={diagnostics?.connectionState ?? '—'} />
            <Row label="ICE state" value={diagnostics?.iceConnectionState ?? '—'} />
            <Row label="Signalling state" value={diagnostics?.signalingState ?? '—'} />
            <Row label="Candidate type" value={diagnostics?.candidateType ?? '—'} tone={candidateTone} />
            <Row label="Local candidate" value={diagnostics?.localCandidate ?? '—'} />
            <Row label="Remote candidate" value={diagnostics?.remoteCandidate ?? '—'} />
            <Row label="Round trip time" value={diagnostics?.rtt === null || diagnostics?.rtt === undefined ? '—' : `${diagnostics.rtt} ms`} />
            <Row label="Packets lost" value={diagnostics?.packetsLost === null || diagnostics?.packetsLost === undefined ? '—' : String(diagnostics.packetsLost)} tone={diagnostics?.packetsLost ? 'warn' : undefined} />
            <Row label="Jitter" value={diagnostics?.jitter === null || diagnostics?.jitter === undefined ? '—' : `${diagnostics.jitter} ms`} />
            <Row label="Audio bitrate" value={bitrate(diagnostics?.audioBitrate ?? null)} />
            <Row label="Video bitrate" value={bitrate(diagnostics?.videoBitrate ?? null)} />
            <Row label="Video resolution" value={diagnostics?.videoResolution ?? '—'} />
            <Row label="Frame rate" value={diagnostics?.frameRate === null || diagnostics?.frameRate === undefined ? '—' : `${diagnostics.frameRate} fps`} />
            <Row label="Remote stream" value={remoteStream ? `${remoteStream.getTracks().length} track(s)` : 'none'} />
            <p className="pt-1 text-[10px] leading-relaxed text-ink-500">
              Statistics come from RTCPeerConnection.getStats(). A mobile or carrier network usually needs a STUN
              address, and a strict NAT needs a TURN relay — both are configured in Settings.
            </p>
          </div>
        ) : null}

        {tab === 'security' ? (
          <div className="space-y-3">
            <div className="rounded-2xl border border-ink-800 bg-ink-850 p-4">
              <p className="label mb-1.5">Safety code</p>
              <p className="mono text-base tracking-widest text-ink-100">{safetyCode ?? '— — — —'}</p>
              <p className="mt-2 text-[11px] leading-relaxed text-ink-400">
                Derived from both peers&apos; public keys. Read it aloud on another channel — if the two devices show the
                same code, nobody swapped identities during the QR exchange.
              </p>
            </div>
            <Row label="Transport encryption" value="DTLS-SRTP (browser)" tone="ok" />
            <Row label="Media encryption" value="SRTP (browser)" tone="ok" />
            <Row
              label="Application layer key"
              value={encryptionReady ? 'ECDH P-256 + AES-256-GCM' : 'not established'}
              tone={encryptionReady ? 'ok' : 'warn'}
            />
            <Row label="Payload encryption" value={preferences.encrypt && encryptionReady ? 'active' : preferences.encrypt ? 'waiting for key' : 'disabled'} />
            <Row label="Signalling authenticity" value="QR/text is not signed" tone="warn" />
            <Row label="Storage" value={preferences.keepHistory ? 'local IndexedDB only' : 'disabled'} />
            <Row label="Analytics / telemetry" value="none" tone="ok" />
            <div className="rounded-2xl border border-warn/30 bg-warn/5 p-4 text-[11px] leading-relaxed text-ink-300">
              <p className="mb-1 font-medium text-warn">What this does not protect against</p>
              OpenCall cannot authenticate the peer from the QR code alone, cannot hide the fact that a connection
              exists from your network operator, and does not provide anonymity. If the code mismatches, end the session.
            </div>
          </div>
        ) : null}

        {tab === 'log' ? (
          <div className="space-y-1">
            {log.length === 0 ? <p className="text-xs text-ink-500">No events yet.</p> : null}
            {log.slice().reverse().map((entry) => (
              <div key={entry.id} className="flex gap-2 border-b border-ink-800/60 py-1.5 last:border-0">
                <span className="mono shrink-0 text-ink-500">{new Date(entry.ts).toLocaleTimeString()}</span>
                <span
                  className={`text-[11px] leading-relaxed ${
                    entry.level === 'error' ? 'text-bad' : entry.level === 'warn' ? 'text-warn' : 'text-ink-300'
                  }`}
                >
                  {entry.text}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
