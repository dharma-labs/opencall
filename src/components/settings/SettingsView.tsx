import { useEffect, useState, type ReactNode } from 'react';
import { useOpenCall } from '../../contexts/OpenCallContext';
import { buildIceConfig, describeIcePlan, PUBLIC_STUN_URLS } from '../../modules/connection/ICEManager';
import { DEFAULT_BROKERS } from '../../modules/connection/SignalBus';
import { useInstallState } from '../../modules/platform/PwaManager';
import { Button, Icon, Pill, Toggle } from '../common/UI';

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="panel p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-ink-100">{title}</h2>
      {hint ? <p className="mt-1 text-xs leading-relaxed text-ink-400">{hint}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-ink-800 pt-3">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-[11px] font-medium text-ink-400 transition-colors hover:text-ink-200"
      >
        <span>{label}</span>
        <Icon name={open ? 'chevron-left' : 'chevron-right'} className="h-3.5 w-3.5" />
      </button>
      {open ? <div className="mt-3 flex flex-col gap-3">{children}</div> : null}
    </div>
  );
}

export function SettingsView() {
  const { preferences, updatePreferences, devices, refreshDevices, log, safetyCode, encryptionReady, status, peerLabel, role } =
    useOpenCall();
  const { runtime, installed } = useInstallState();

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  const microphones = devices.filter((device) => device.kind === 'audioinput');
  const cameras = devices.filter((device) => device.kind === 'videoinput');
  const plan = describeIcePlan(buildIceConfig(preferences));

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-7 sm:px-5 sm:py-10">
      <header>
        <h1 className="text-base font-semibold text-ink-100">Settings</h1>
      </header>

      <Section title="You" hint="The name the other device sees once the connection opens.">
        <label className="block">
          <span className="label">Display name</span>
          <input
            className="input mt-1"
            value={preferences.displayName}
            maxLength={32}
            onChange={(event) => updatePreferences({ displayName: event.target.value })}
            placeholder="Shown to the other device"
          />
        </label>
      </Section>

      <Section title="Connection">
        <div>
          <label className="block">
            <span className="label">Signalling relays</span>
            <textarea
              className="input mt-1 resize-y font-mono text-[11px] leading-relaxed"
              rows={2}
              spellCheck={false}
              value={preferences.signalingBrokers}
              onChange={(event) => updatePreferences({ signalingBrokers: event.target.value })}
              placeholder={DEFAULT_BROKERS.join('\n')}
            />
          </label>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
            One WebSocket URL per line; empty uses{' '}
            <span className="mono">{DEFAULT_BROKERS.join(', ')}</span>. A relay only carries the room code, name and
            SDP — never messages, calls or files.
          </p>
        </div>

        <div className="mt-3 border-t border-ink-800 pt-3">
          <Toggle
            label="Free relay fallback"
            hint={`Punches through strict networks over TCP/443. Currently: ${plan}.`}
            checked={preferences.useFreeRelay}
            onChange={(next) => updatePreferences({ useFreeRelay: next })}
          />
          <Toggle
            label="Public STUN"
            hint="Finds a direct path first. STUN never sees content."
            checked={preferences.usePublicStun}
            onChange={(next) => updatePreferences({ usePublicStun: next })}
          />
        </div>

        <Disclosure label="Custom ICE servers">
          <label className="block">
            <span className="label">Relay servers (optional)</span>
            <textarea
              className="input mt-1 resize-y font-mono text-[11px] leading-relaxed"
              rows={3}
              spellCheck={false}
              value={preferences.customIceServers}
              onChange={(event) => updatePreferences({ customIceServers: event.target.value })}
              placeholder={'turn:turn.example.org:3478|user|secret\nstun:stun.example.org:3478'}
            />
          </label>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
            One per line: <span className="mono">stun:host:port</span> or{' '}
            <span className="mono">turn:host:port|user|secret</span>. A TURN relay you run yourself keeps the traffic
            on infrastructure you control.
          </p>
          <div className="text-[11px] leading-relaxed text-ink-500">
            Defaults: <span className="mono">{PUBLIC_STUN_URLS.join(', ')}</span>
          </div>
        </Disclosure>
      </Section>

      <Section title="Privacy" hint="Local storage and the extra application-layer encryption.">
        <Toggle
          label="Encrypt messages end to end"
          hint="Adds ECDH key agreement and AES-256-GCM on top of WebRTC's DTLS, so even the transport cannot read the payloads."
          checked={preferences.encrypt}
          onChange={(next) => updatePreferences({ encrypt: next })}
        />
        <Toggle
          label="Keep conversations in this browser"
          hint="Stores the transcript in IndexedDB so the History tab works. Nothing leaves the device."
          checked={preferences.keepHistory}
          onChange={(next) => updatePreferences({ keepHistory: next })}
        />
        <div className="mt-3 flex flex-wrap gap-2 border-t border-ink-800 pt-3">
          <Pill tone={encryptionReady ? 'ok' : 'neutral'} dot>
            {encryptionReady ? 'Channel key ready' : 'No key yet'}
          </Pill>
          <Pill tone={preferences.keepHistory ? 'ok' : 'neutral'} dot>
            {preferences.keepHistory ? 'Local history on' : 'Local history off'}
          </Pill>
          <Pill tone="ok" dot>
            No analytics
          </Pill>
        </div>
      </Section>

      <Section title="Audio" hint="Applies to the next call you start.">
        <Toggle
          label="Echo cancellation"
          checked={preferences.echoCancellation}
          onChange={(next) => updatePreferences({ echoCancellation: next })}
        />
        <Toggle
          label="Noise suppression"
          checked={preferences.noiseSuppression}
          onChange={(next) => updatePreferences({ noiseSuppression: next })}
        />
        <Toggle
          label="Automatic gain control"
          checked={preferences.autoGainControl}
          onChange={(next) => updatePreferences({ autoGainControl: next })}
        />
      </Section>

      <Section title="Devices" hint="Labels appear once you have granted permission to the camera or microphone.">
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className="text-[11px] text-ink-400">Microphone</span>
            <select
              className="input mt-1"
              value={preferences.micDeviceId ?? ''}
              onChange={(event) => updatePreferences({ micDeviceId: event.target.value || null })}
            >
              <option value="">System default</option>
              {microphones.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] text-ink-400">Camera</span>
            <select
              className="input mt-1"
              value={preferences.camDeviceId ?? ''}
              onChange={(event) => updatePreferences({ camDeviceId: event.target.value || null })}
            >
              <option value="">System default</option>
              {cameras.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </option>
              ))}
            </select>
          </label>
          <div>
            <Button size="sm" icon="refresh" onClick={() => void refreshDevices()}>
              Refresh devices
            </Button>
          </div>
        </div>
      </Section>

      <Section title="This session">
        <dl className="grid grid-cols-2 gap-y-2 text-xs">
          <dt className="text-ink-400">Status</dt>
          <dd className="text-right text-ink-200">{status}</dd>
          <dt className="text-ink-400">Role</dt>
          <dd className="text-right text-ink-200">{role ?? 'none'}</dd>
          <dt className="text-ink-400">Peer</dt>
          <dd className="text-right text-ink-200">{peerLabel}</dd>
          <dt className="text-ink-400">Safety code</dt>
          <dd className="mono text-right text-ink-200">{safetyCode ?? '—'}</dd>
          <dt className="text-ink-400">Runs as</dt>
          <dd className="text-right text-ink-200">{installed ? `${runtime} · installed` : runtime}</dd>
        </dl>

        <div className="mt-3">
          <Disclosure label="Activity log">
            {log.length === 0 ? (
              <p className="text-xs text-ink-500">Nothing has happened yet.</p>
            ) : (
              <div className="max-h-56 space-y-1 overflow-y-auto">
                {log
                  .slice()
                  .reverse()
                  .map((entry) => (
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
            )}
          </Disclosure>
        </div>
      </Section>

      <p className="pb-2 text-[11px] leading-relaxed text-ink-500">
        Clearing this browser&apos;s site data removes every stored conversation and setting permanently.
      </p>
    </div>
  );
}
