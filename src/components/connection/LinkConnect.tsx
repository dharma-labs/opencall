import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOpenCall } from '../../contexts/OpenCallContext';
import { Icon, IconButton, Pill, Button } from '../common/UI';

/**
 * The whole connection flow in one screen: this device makes a link, the other
 * device opens it. Two cities, two carriers, no camera and nothing to type.
 */
export function LinkConnect() {
  const { linkUrl, linkStatus, linkRoom, peerLabel, status, error, clearError, cancelLink, startHost, startGuest } =
    useOpenCall();
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const waiting = status === 'preparing' || status === 'awaiting-peer';

  const copy = useCallback(async () => {
    if (!linkUrl) return;
    try {
      await navigator.clipboard?.writeText(linkUrl);
      setCopied(true);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }, [linkUrl]);

  const fallbackLink = useMemo(
    () => `Paste this code into OpenCall on the other device: ${linkRoom}`,
    [linkRoom],
  );

  return (
    <div className="mx-auto flex w-full max-w-xl animate-rise flex-col gap-4 px-4 py-6 sm:py-9">
      <div className="screen-head">
        <Pill tone={waiting ? 'warn' : status === 'failed' ? 'bad' : 'accent'} dot>
          {waiting ? 'Waiting for the other device' : status === 'failed' ? 'Not connected' : peerLabel}
        </Pill>
        <Button size="sm" variant="ghost" icon="x" onClick={cancelLink}>
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

      <section className="panel flex flex-col items-center gap-4 p-6 sm:p-8">
        <span className="relative flex items-center justify-center">
          <span className="splash-halo animate-halo" />
          <span className="avatar avatar-lg">
            {peerLabel.slice(0, 1).toUpperCase()}
            <span className={`avatar-dot ${waiting ? '' : 'avatar-dot-on'}`} />
          </span>
        </span>

        <h1 className="text-center text-base font-semibold text-ink-100">
          {waiting ? 'Send the link' : peerLabel}
        </h1>

        {linkUrl ? (
          <button type="button" className="link-card" onClick={() => void copy()} title={fallbackLink}>
            {linkUrl}
          </button>
        ) : (
          <p className="text-center text-xs text-ink-400">
            This build has no web address to link to, so share the room code instead: <span className="mono">{linkRoom}</span>
          </p>
        )}

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button size="sm" variant="primary" icon={copied ? 'check' : 'copy'} onClick={() => void copy()}>
            {copied ? 'Copied' : 'Copy link'}
          </Button>
          {canShare ? (
            <Button
              size="sm"
              icon="send"
              onClick={() => {
                void navigator
                  .share({ title: 'OpenCall', text: 'Tap to talk with me', url: linkUrl || fallbackLink })
                  .catch(() => undefined);
              }}
            >
              Share
            </Button>
          ) : null}
        </div>

        <p className="min-h-[16px] text-center text-[11px] leading-relaxed text-ink-500">{linkStatus}</p>
      </section>

      <section className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setManual((prev) => !prev)}
          aria-expanded={manual}
          className="flex items-center justify-between gap-2 px-1 text-[11px] font-medium text-ink-400 transition-colors hover:text-ink-200"
        >
          <span>No internet relay? Connect by hand</span>
          <Icon name={manual ? 'menu-down' : 'chevron-right'} className="h-3.5 w-3.5" />
        </button>

        {manual ? (
          <div className="panel flex flex-col gap-1 p-2">
            <button type="button" className="list-row" onClick={() => void startHost()}>
              <span className="row-icon">
                <Icon name="qr" className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-ink-100">Show a code</span>
                <span className="mt-0.5 block text-xs text-ink-400">Two devices hand the handshake over in person.</span>
              </span>
              <IconButton icon="arrow-right" label="Show a code" className="pointer-events-none" />
            </button>
            <button type="button" className="list-row" onClick={startGuest}>
              <span className="row-icon">
                <Icon name="link" className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-ink-100">Paste an invite</span>
                <span className="mt-0.5 block text-xs text-ink-400">Scan a code or paste the data they sent.</span>
              </span>
              <IconButton icon="arrow-right" label="Paste an invite" className="pointer-events-none" />
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
