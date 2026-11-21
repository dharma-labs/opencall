import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useOpenCall } from '../../contexts/OpenCallContext';
import { QrScanner, qrDataUrl } from '../../modules/connection/QRManager';
import { buildShareLink, downloadSignalFile, readSignalFile } from '../../modules/connection/SignalingManager';
import { formatBytes } from '../../utils';
import { Button, CopyField, Icon, IconButton, Pill } from '../common/UI';

/* ------------------------------------------------------------------ QR */

function QrDisplay({ parts, index, onIndex }: { parts: string[]; index: number; onIndex: (next: number) => void }) {
  const [image, setImage] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const value = parts[Math.min(index, parts.length - 1)] ?? '';

  useEffect(() => {
    let cancelled = false;
    if (!value) {
      setImage(null);
      return;
    }
    qrDataUrl(value)
      .then((url) => {
        if (!cancelled) {
          setImage(url);
          setFailure(null);
        }
      })
      .catch(() => {
        if (!cancelled) setFailure('This payload is too large for a QR code. Use the link or copy/paste instead.');
      });
    return () => {
      cancelled = true;
    };
  }, [value]);

  // Only large payloads arrive in several parts; they rotate so one scan
  // session can capture them all.
  useEffect(() => {
    if (parts.length < 2) return;
    const timer = window.setInterval(() => onIndex((index + 1) % parts.length), 3500);
    return () => window.clearInterval(timer);
  }, [parts.length, index, onIndex]);

  if (failure) {
    return <div className="rounded-2xl border border-warn/30 bg-warn/5 p-6 text-center text-xs text-warn">{failure}</div>;
  }

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <div className="qr-frame">
        {image ? (
          <img src={image} alt="Connection QR code" className="h-64 w-64 sm:h-72 sm:w-72" />
        ) : (
          <div className="flex h-64 w-64 items-center justify-center sm:h-72 sm:w-72">
            <Icon name="spinner" className="h-5 w-5 animate-spin text-ink-400" />
          </div>
        )}
      </div>

      {parts.length > 1 ? (
        <div className="flex w-full items-center justify-between gap-2">
          <IconButton
            icon="chevron-left"
            label="Previous part"
            onClick={() => onIndex((index - 1 + parts.length) % parts.length)}
          />
          <span className="text-xs font-medium text-ink-200">
            Part {index + 1} of {parts.length}
          </span>
          <IconButton icon="chevron-right" label="Next part" onClick={() => onIndex((index + 1) % parts.length)} />
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ sharing */

/**
 * The easiest hand-off of all: a link whose payload lives in the URL fragment,
 * which browsers never send to a server. Hidden inside packaged desktop and
 * mobile builds, where there is no shareable origin.
 */
function ShareRow({ payload }: { payload: string }) {
  const link = useMemo(() => buildShareLink(payload), [payload]);
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  if (!link) return null;

  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(link);
      setCopied(true);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex w-full flex-wrap items-center justify-center gap-2">
      <Button size="sm" variant="primary" icon={copied ? 'check' : 'link'} onClick={() => void copy()}>
        {copied ? 'Link copied' : 'Copy invite link'}
      </Button>
      {canShare ? (
        <Button
          size="sm"
          icon="send"
          onClick={() => {
            void navigator.share({ title: 'OpenCall', text: 'Join my OpenCall session', url: link }).catch(() => undefined);
          }}
        >
          Send link
        </Button>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ scanner */

function Scanner({ onText, autoStart = false }: { onText: (text: string) => void; autoStart?: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const start = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    setError(null);
    try {
      const scanner = new QrScanner({
        video,
        onResult: (text) => onTextRef.current(text),
        onError: (message) => setError(message),
      });
      await scanner.start();
      scannerRef.current = scanner;
      setActive(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The camera could not be started.');
      setActive(false);
    }
  }, []);

  const stop = useCallback(() => {
    scannerRef.current?.stop();
    scannerRef.current = null;
    setActive(false);
  }, []);

  useEffect(() => {
    if (autoStart) void start();
    return () => {
      scannerRef.current?.stop();
      scannerRef.current = null;
    };
  }, [autoStart, start]);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative overflow-hidden rounded-3xl border border-ink-800 bg-ink-950">
        <video ref={videoRef} className="aspect-video w-full object-cover" muted playsInline />
        {!active ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-ink-950/70">
            <Icon name="camera" className="h-5 w-5 text-ink-400" />
            <p className="text-xs text-ink-400">Camera is off</p>
          </div>
        ) : (
          <div className="pointer-events-none absolute inset-8 rounded-2xl border-2 border-accent/60" />
        )}
      </div>
      {error ? <p className="text-xs text-bad">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        {active ? (
          <Button size="sm" icon="x" onClick={stop}>
            Stop camera
          </Button>
        ) : (
          <Button size="sm" variant="primary" icon="camera" onClick={() => void start()}>
            Start camera
          </Button>
        )}
        <span className="text-[11px] text-ink-500">Frames are read on this device and never uploaded.</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ paste */

function PasteBox({
  label,
  placeholder,
  onSubmit,
  submitLabel,
  disabled,
}: {
  label: string;
  placeholder: string;
  onSubmit: (text: string) => Promise<void> | void;
  submitLabel: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const submit = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await onSubmit(text.trim());
    } finally {
      setBusy(false);
    }
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const payload = await readSignalFile(file);
      setText(payload);
    } catch (cause) {
      setText(cause instanceof Error ? cause.message : '');
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="label">{label}</span>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={placeholder}
        rows={3}
        className="input resize-none font-mono text-[11px] leading-relaxed"
      />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="primary"
          icon="check"
          onClick={() => void submit()}
          disabled={disabled || busy || !text.trim()}
        >
          {busy ? 'Working…' : submitLabel}
        </Button>
        <Button size="sm" icon="upload" onClick={() => fileRef.current?.click()}>
          Import file
        </Button>
        {text ? (
          <Button size="sm" variant="ghost" icon="x" onClick={() => setText('')}>
            Clear
          </Button>
        ) : null}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json,.txt"
        className="hidden"
        onChange={(event) => {
          void importFile(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
    </div>
  );
}

function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="w-full border-t border-ink-800 pt-3">
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

/* ------------------------------------------------------------------ screen */

export function ConnectionSetup() {
  const {
    phase,
    role,
    status,
    localPayload,
    qrParts,
    qrIndex,
    setQrIndex,
    scannedParts,
    scanTotal,
    addScannedPart,
    resetScan,
    submitGuestData,
    completeAsHost,
    cancelSetup,
    error,
    clearError,
  } = useOpenCall();

  const isHost = role === 'host';
  const [guestMode, setGuestMode] = useState<'scan' | 'paste'>('scan');

  const title = useMemo(() => {
    if (phase === 'host-prepare') return 'Creating your invite…';
    if (phase === 'host-wait-answer') return 'Step 1 · Let them scan this';
    if (phase === 'guest-enter') return 'Join a connection';
    return 'Step 2 · Send this back';
  }, [phase]);

  const qrKey = useMemo(() => qrParts.length, [qrParts.length]);
  const single = qrParts.length === 1;

  return (
    <div className="mx-auto flex w-full max-w-2xl animate-rise flex-col gap-4 px-4 py-6 sm:px-5 sm:py-9">
      <div className="screen-head">
        <div className="flex min-w-0 items-center gap-2.5">
          <Pill tone={isHost ? 'accent' : 'neutral'} dot>
            {isHost ? 'Host' : 'Guest'}
          </Pill>
          <h1 className="truncate text-sm font-semibold text-ink-100">{title}</h1>
        </div>
        <Button size="sm" variant="ghost" icon="x" onClick={cancelSetup}>
          Cancel
        </Button>
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-2xl border border-bad/30 bg-bad/5 p-3">
          <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0 text-bad" />
          <div className="flex-1 text-xs leading-relaxed text-ink-200">
            {error}
            <button type="button" onClick={clearError} className="ml-2 text-accent underline">
              dismiss
            </button>
          </div>
        </div>
      ) : null}

      {isHost ? (
        <>
          <section className="panel flex flex-col items-center gap-4 p-5 sm:p-6">
            {qrParts.length ? (
              <QrDisplay key={qrKey} parts={qrParts} index={qrIndex} onIndex={setQrIndex} />
            ) : (
              <div className="flex h-64 items-center justify-center">
                <Icon name="spinner" className="h-5 w-5 animate-spin text-ink-400" />
              </div>
            )}
            <p className="max-w-sm text-center text-xs leading-relaxed text-ink-400">
              {single
                ? 'One code is all they need. Ask them to open OpenCall, choose Join, and point their camera here.'
                : 'This code cycles through a few parts — keep the camera on it until they are all captured.'}
            </p>
            <ShareRow payload={localPayload} />
            <Disclosure label="Other ways to hand it over">
              <CopyField value={localPayload} label="Invite data (copy/paste)" rows={3} />
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  size="sm"
                  icon="download"
                  onClick={() => downloadSignalFile(localPayload, 'opencall-invite.json')}
                  disabled={!localPayload}
                >
                  Export invite file
                </Button>
                <span className="text-[11px] text-ink-500">{formatBytes(localPayload.length)} of connection data</span>
              </div>
            </Disclosure>
          </section>

          <section className="panel flex flex-col gap-4 p-5 sm:p-6">
            <div>
              <h2 className="text-sm font-semibold text-ink-100">Step 2 · Scan their answer</h2>
              <p className="mt-1 text-xs leading-relaxed text-ink-400">
                When they show you their reply code, point your camera at it. Nothing to type.
              </p>
            </div>
            <Scanner onText={(text) => void completeAsHost(text)} />
            <Disclosure label="Or paste their reply">
              <PasteBox
                label="Response from the other device"
                placeholder="Paste their reply link or code"
                submitLabel="Complete connection"
                disabled={status === 'connecting' || status === 'connected'}
                onSubmit={(text) => completeAsHost(text)}
              />
            </Disclosure>
          </section>
        </>
      ) : (
        <>
          {phase === 'guest-enter' ? (
            <section className="panel flex flex-col gap-4 p-5 sm:p-6">
              <div className="seg">
                <button
                  type="button"
                  onClick={() => setGuestMode('scan')}
                  className={`seg-btn flex-1 justify-center ${guestMode === 'scan' ? 'seg-btn-on' : 'seg-btn-off'}`}
                >
                  <Icon name="camera" className="h-3.5 w-3.5" />
                  Scan code
                </button>
                <button
                  type="button"
                  onClick={() => setGuestMode('paste')}
                  className={`seg-btn flex-1 justify-center ${guestMode === 'paste' ? 'seg-btn-on' : 'seg-btn-off'}`}
                >
                  <Icon name="link" className="h-3.5 w-3.5" />
                  Paste link
                </button>
              </div>

              {guestMode === 'scan' ? (
                <>
                  <Scanner autoStart onText={(text) => void addScannedPart(text)} />
                  {scannedParts > 0 && scanTotal > 1 ? (
                    <div className="flex items-center justify-between gap-3 rounded-2xl border border-ink-800 bg-ink-850 px-4 py-2.5">
                      <span className="text-xs text-ink-200">
                        Captured {scannedParts} of {scanTotal} parts
                      </span>
                      <Button size="sm" variant="ghost" icon="refresh" onClick={resetScan}>
                        Reset
                      </Button>
                    </div>
                  ) : null}
                </>
              ) : (
                <PasteBox
                  label="Invite link or data"
                  placeholder="Paste the invite link they sent, or the raw code"
                  submitLabel="Continue"
                  onSubmit={(text) => submitGuestData(text)}
                />
              )}
            </section>
          ) : (
            <section className="panel flex flex-col items-center gap-4 p-5 sm:p-6">
              <Pill tone="warn" dot>
                Waiting for their camera
              </Pill>
              {qrParts.length ? <QrDisplay key={qrKey} parts={qrParts} index={qrIndex} onIndex={setQrIndex} /> : null}
              <p className="max-w-sm text-center text-xs leading-relaxed text-ink-400">
                Show this back to the device that created the invite, or send the link. The line opens the moment they
                accept it.
              </p>
              <ShareRow payload={localPayload} />
              <Disclosure label="Other ways to send it back">
                <CopyField value={localPayload} label="Response data" rows={3} />
                <div className="flex flex-wrap items-center gap-3">
                  <Button size="sm" icon="download" onClick={() => downloadSignalFile(localPayload, 'opencall-response.json')}>
                    Export response file
                  </Button>
                  <span className="text-[11px] text-ink-500">{formatBytes(localPayload.length)} of connection data</span>
                </div>
              </Disclosure>
            </section>
          )}
        </>
      )}

      <p className="text-[11px] leading-relaxed text-ink-500">
        The exchange carries the session description and ICE candidates. A public STUN server may help the two devices
        find each other; it never carries your messages, calls or files. The code is not signed, so verify the safety
        code once you are connected.
      </p>
    </div>
  );
}
