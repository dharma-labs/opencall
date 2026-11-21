import { useCallback, useEffect, useRef, useState } from 'react';
import { useOpenCall } from '../../contexts/OpenCallContext';
import type { HistoryEntry } from '../../types';
import { listConversations } from '../../modules/storage/StorageManager';
import { launchAction } from '../../modules/platform/PwaManager';
import { Icon } from '../common/UI';

/** Pulls a room code out of a pasted invite link, or accepts a bare code. */
function roomFromText(text: string): string | null {
  const value = text.trim();
  const matched = /[?&#]r=([a-z0-9-]{4,40})/i.exec(value);
  if (matched) return matched[1].toLowerCase();
  if (/^[a-z0-9-]{6,40}$/i.test(value)) return value.toLowerCase();
  return null;
}

/**
 * Home is two actions and the conversations you have already had — the shape of
 * a messenger, not a brochure.
 */
export function Landing() {
  const { startLink, peerLabel } = useOpenCall();
  const [recent, setRecent] = useState<HistoryEntry[]>([]);
  const [joinText, setJoinText] = useState('');
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const joinRef = useRef<HTMLInputElement | null>(null);

  // The "Join" app shortcut lands here; the paste field is ready to type in.
  useEffect(() => {
    if (launchAction() === 'join') joinRef.current?.focus();
  }, []);

  useEffect(() => {
    void listConversations().then((entries) => setRecent(entries.slice(0, 6)));
  }, [peerLabel]);

  const create = useCallback(async () => {
    setBusy(true);
    try {
      await startLink();
    } finally {
      setBusy(false);
    }
  }, [startLink]);

  const join = useCallback(async () => {
    const room = roomFromText(joinText);
    if (!room) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setBusy(true);
    try {
      await startLink(room);
    } finally {
      setBusy(false);
    }
  }, [joinText, startLink]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-3 py-4 sm:px-5 sm:py-6">
      <button
        type="button"
        onClick={() => void create()}
        disabled={busy}
        className="btn btn-primary w-full justify-start gap-3 rounded-2xl px-4 py-4 text-base"
      >
        <Icon name="phone-plus" className="h-5 w-5" />
        <span className="flex-1 text-left">{busy ? 'Opening…' : 'New call'}</span>
        <Icon name="arrow-right" className="h-4 w-4 opacity-70" />
      </button>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void join();
        }}
        className="panel flex items-center gap-2 p-2"
      >
        <span className="row-icon h-9 w-9 shrink-0">
          <Icon name="link" className="h-4 w-4" />
        </span>
        <input
          ref={joinRef}
          value={joinText}
          onChange={(event) => {
            setJoinText(event.target.value);
            setInvalid(false);
          }}
          placeholder={invalid ? 'That is not an OpenCall link' : 'Paste a link to join'}
          className={`input flex-1 border-transparent bg-transparent focus:ring-0 ${invalid ? 'text-bad' : ''}`}
        />
        <button type="submit" className="send-btn" aria-label="Join" disabled={!joinText.trim() || busy}>
          <Icon name="arrow-right" className="h-4 w-4" />
        </button>
      </form>

      {recent.length ? (
        <section className="panel mt-2 flex flex-col overflow-hidden lg:hidden">
          {recent.map((entry) => (
            <button
              key={entry.session}
              type="button"
              onClick={() => void startLink(entry.session)}
              className="chatlist-row chatlist-row-off border-b border-ink-800/60 last:border-0"
            >
              <span className="avatar">{entry.peer.slice(0, 1).toUpperCase()}</span>
              <span className="min-w-0 flex-1">
                <span className="chatlist-title">{entry.peer}</span>
                <span className="chatlist-snippet">{entry.lastMessage ?? 'Tap to call again'}</span>
              </span>
              <Icon name="phone" className="h-4 w-4 shrink-0 text-ink-500" />
            </button>
          ))}
        </section>
      ) : null}
    </div>
  );
}
