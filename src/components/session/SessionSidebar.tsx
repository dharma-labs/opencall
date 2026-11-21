import { useCallback, useEffect, useState } from 'react';
import { useOpenCall } from '../../contexts/OpenCallContext';
import type { HistoryEntry } from '../../types';
import { listConversations } from '../../modules/storage/StorageManager';
import { Icon, Pill } from '../common/UI';

/**
 * The left rail of a messenger: who you are talking to now, then every past
 * conversation, each of which is one tap away from being a live call again.
 */
export function SessionSidebar({ onRecall }: { onRecall: (session: string) => void }) {
  const { peerLabel, status, phase, startLink, preferences } = useOpenCall();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const inSession = phase === 'session';

  const refresh = useCallback(() => {
    void listConversations().then((list) => setEntries(inSession ? list.slice(1) : list));
  }, [inSession]);

  useEffect(refresh, [refresh, status]);

  return (
    <aside className="sidebar">
      <div className="flex items-center justify-between gap-2 border-b border-ink-800/70 px-3 py-2.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="avatar">
            {(preferences.displayName || 'You').slice(0, 1).toUpperCase()}
            <span className={`avatar-dot ${inSession ? 'avatar-dot-on' : ''}`} />
          </span>
          <span className="min-w-0">
            <span className="chatlist-title block">{preferences.displayName || 'You'}</span>
            <span className="chatlist-snippet block">{inSession ? 'Live' : 'Ready'}</span>
          </span>
        </span>
        <Pill tone={inSession ? 'ok' : 'neutral'} dot>
          {entries.length + (inSession ? 1 : 0)}
        </Pill>
      </div>

      <div className="chatlist">
        <button
          type="button"
          onClick={() => void startLink()}
          className="chatlist-row chatlist-row-off w-full border-b border-ink-800/60"
        >
          <span className="row-icon border-accent/40 bg-accent/10 text-accent">
            <Icon name="plus" className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="chatlist-title block">New call</span>
            <span className="chatlist-snippet block">Make a link, send it, talk.</span>
          </span>
          <Icon name="arrow-right" className="h-4 w-4 shrink-0 text-accent" />
        </button>

        {inSession ? (
          <button type="button" className="chatlist-row chatlist-row-on w-full border-b border-ink-800/60">
            <span className="avatar">
              {peerLabel.slice(0, 1).toUpperCase()}
              <span className={`avatar-dot ${status === 'connected' ? 'avatar-dot-on' : ''}`} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="chatlist-title block">{peerLabel}</span>
              <span className="chatlist-snippet block">
                {status === 'connected' ? 'Direct line open' : 'Reconnecting…'}
              </span>
            </span>
            <Icon name="activity" className="h-4 w-4 shrink-0 text-accent" />
          </button>
        ) : null}

        {entries.map((entry) => (
          <button
            key={entry.session}
            type="button"
            onClick={() => onRecall(entry.session)}
            className="chatlist-row chatlist-row-off w-full border-b border-ink-800/60 last:border-0"
          >
            <span className="avatar">{entry.peer.slice(0, 1).toUpperCase()}</span>
            <span className="min-w-0 flex-1">
              <span className="chatlist-title block">{entry.peer}</span>
              <span className="chatlist-snippet block">{entry.lastMessage ?? 'No messages stored'}</span>
            </span>
            <Icon name="phone" className="h-4 w-4 shrink-0 text-ink-500" />
          </button>
        ))}

        {!entries.length && !inSession ? (
          <p className="px-4 py-6 text-center text-xs leading-relaxed text-ink-500">
            No conversations yet. Start a call and the link you send becomes the chat.
          </p>
        ) : null}
      </div>
    </aside>
  );
}
