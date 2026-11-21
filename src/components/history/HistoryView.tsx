import { useCallback, useEffect, useState } from 'react';
import type { ChatMessage, HistoryEntry } from '../../types';
import { formatClock } from '../../utils';
import { clearConversation, listConversations, loadConversation } from '../../modules/storage/StorageManager';
import { Button, Empty, Icon, Modal, Pill } from '../common/UI';

function relativeTime(ts: number): string {
  if (!ts) return '—';
  const seconds = Math.round((Date.now() - ts) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function Transcript({ messages, peer }: { messages: ChatMessage[]; peer: string }) {
  if (!messages.length) return <p className="text-xs text-ink-500">This conversation has no stored messages.</p>;
  return (
    <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto pr-1">
      {messages.map((message) => {
        const mine = message.sender === 'local';
        return (
          <div key={message.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
            <span className={`bubble ${mine ? 'bubble-out' : 'bubble-in'} max-w-[80%] px-3 py-2`}>
              <span className="whitespace-pre-wrap break-words">{message.text}</span>
              <span className="bubble-meta ml-2 inline-flex translate-y-[2px] text-[10px] tabular-nums">
                {formatClock(message.ts)}
              </span>
            </span>
            <span className="mt-0.5 px-1 text-[10px] text-ink-500">{mine ? 'You' : peer}</span>
          </div>
        );
      })}
    </div>
  );
}

export function HistoryView({ onConnect }: { onConnect: () => void }) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<HistoryEntry | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(await listConversations());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openEntry = async (entry: HistoryEntry) => {
    setOpen(entry);
    setMessages(await loadConversation(entry.session));
  };

  const remove = async (entry: HistoryEntry) => {
    await clearConversation(entry.session);
    setOpen(null);
    await refresh();
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-7 sm:px-5 sm:py-10">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold text-ink-100">History</h1>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-400">
            Sessions are stored in this browser only. Nothing is uploaded, and clearing them is permanent.
          </p>
        </div>
        <Button size="sm" icon="refresh" onClick={() => void refresh()}>
          Refresh
        </Button>
      </header>

      {loading ? (
        <div className="panel flex items-center justify-center gap-2 p-10 text-xs text-ink-400">
          <Icon name="spinner" className="h-4 w-4 animate-spin" />
          Reading local storage…
        </div>
      ) : entries.length === 0 ? (
        <div className="panel">
          <Empty
            icon="clock"
            title="No stored sessions"
            hint="Once you send a message, the conversation is kept here so you can read it back later."
          />
          <div className="flex justify-center pb-6">
            <Button variant="primary" icon="plus" onClick={onConnect}>
              Start a connection
            </Button>
          </div>
        </div>
      ) : (
        <ul className="panel flex flex-col divide-y divide-ink-800/70 overflow-hidden">
          {entries.map((entry) => (
            <li key={entry.session}>
              <button type="button" className="list-row rounded-none" onClick={() => void openEntry(entry)}>
                <span className="avatar">{entry.peer.slice(0, 1).toUpperCase()}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-ink-100">{entry.peer}</span>
                    <span className="shrink-0 text-[10px] text-ink-500">{relativeTime(entry.updatedAt)}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-ink-400">
                    {entry.lastMessage ?? 'No messages stored'}
                  </span>
                </span>
                <Pill tone="neutral">{entry.messageCount}</Pill>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Modal open={open !== null} onClose={() => setOpen(null)} title={open?.peer ?? 'Conversation'} wide>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="neutral">{messages.length} messages</Pill>
            <Pill tone="neutral">{open ? relativeTime(open.updatedAt) : ''}</Pill>
          </div>
          <Transcript messages={messages} peer={open?.peer ?? 'Peer'} />
          <div className="flex justify-end gap-2 border-t border-ink-800 pt-3">
            <Button size="sm" variant="danger" icon="trash" onClick={() => (open ? void remove(open) : undefined)}>
              Delete from this device
            </Button>
            <Button size="sm" onClick={() => setOpen(null)}>
              Close
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
