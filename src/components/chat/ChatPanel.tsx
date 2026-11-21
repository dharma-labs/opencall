import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useOpenCall } from '../../contexts/OpenCallContext';
import type { ChatMessage, FileTransfer, ReplyRef } from '../../types';
import { formatBytes, formatClock } from '../../utils';
import { SidePanel } from '../diagnostics/SidePanel';
import { Button, Empty, Icon, IconButton, ProgressBar } from '../common/UI';

const EMOJIS = ['😀', '😂', '🙂', '😉', '😍', '🤔', '😐', '😢', '😡', '👍', '👎', '🙏', '👏', '🔥', '✨', '❤️', '🎉', '💡', '⚠️', '✅'];

const DELIVERY_LABEL: Record<ChatMessage['delivery'], string> = {
  pending: 'Sending',
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
  failed: 'Not acknowledged',
};

const CONNECTION_HINT: Record<string, string> = {
  connected: 'connected · direct line',
  connecting: 'connecting…',
  preparing: 'preparing…',
  'awaiting-peer': 'waiting for the other device',
  degraded: 'degraded · check the network',
  disconnected: 'disconnected',
  failed: 'no direct path',
};

function sameDay(a: number, b: number) {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

function dayLabel(ts: number) {
  const now = new Date();
  const date = new Date(ts);
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((midnight - target) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Ticks sit inside the bubble, on the message itself, the way a chat is read:
 * colour carries the meaning, shape confirms it.
 */
function DeliveryMark({ delivery }: { delivery: ChatMessage['delivery'] }) {
  if (delivery === 'failed') return <Icon name="alert" className="h-3 w-3 text-bad" />;
  if (delivery === 'pending') return <Icon name="clock" className="h-3 w-3 opacity-50" />;
  if (delivery === 'sent') return <Icon name="check" className="h-3 w-3 opacity-70" />;
  if (delivery === 'read') return <Icon name="check-check" className="h-3 w-3 text-accent-hover" />;
  return <Icon name="check-check" className="h-3 w-3 opacity-90" />;
}

function TransferRow({ transfer, onCancel }: { transfer: FileTransfer; onCancel: (id: string) => void }) {
  const percent = transfer.size ? (transfer.transferred / transfer.size) * 100 : 0;
  const tone = transfer.state === 'failed' ? 'bad' : transfer.state === 'complete' ? 'ok' : 'accent';
  return (
    <div className="rounded-2xl border border-ink-800 bg-ink-850/70 p-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-ink-800 text-ink-300">
          <Icon name={transfer.direction === 'sending' ? 'upload' : 'download'} className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-xs font-medium text-ink-100" title={transfer.name}>
              {transfer.name}
            </p>
            <span className="shrink-0 text-[11px] tabular-nums text-ink-400">{Math.round(percent)}%</span>
          </div>
          <div className="mt-1.5">
            <ProgressBar value={transfer.transferred} max={transfer.size} tone={tone} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-500">
            <span className="tabular-nums">
              {formatBytes(transfer.transferred)} / {formatBytes(transfer.size)}
            </span>
            <span>·</span>
            <span>{transfer.direction === 'sending' ? 'Sending' : 'Receiving'}</span>
            {transfer.state === 'complete' ? (
              <>
                <span>·</span>
                <span className={transfer.verified === false ? 'text-bad' : 'text-ok'}>
                  {transfer.verified === false ? 'Integrity check failed' : transfer.verified ? 'Integrity verified' : 'Complete'}
                </span>
              </>
            ) : null}
            {transfer.state === 'cancelled' ? <span className="text-warn">· Cancelled</span> : null}
            {transfer.error ? <span className="text-bad">· {transfer.error}</span> : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {transfer.state === 'active' ? (
              <Button size="sm" variant="ghost" icon="x" onClick={() => onCancel(transfer.id)}>
                Cancel
              </Button>
            ) : null}
            {transfer.url ? (
              <a
                className="btn btn-sm"
                href={transfer.url}
                download={transfer.name}
                target="_blank"
                rel="noreferrer noopener"
              >
                <Icon name="download" className="h-3.5 w-3.5" />
                Save
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ChatPanel() {
  const {
    messages,
    sendMessage,
    sendTyping,
    typing,
    transfers,
    cancelTransfer,
    sendFiles,
    deleteMessage,
    clearConversation,
    startVoiceCall,
    startVideoCall,
    call,
    canCall,
    peerLabel,
    status,
    disconnect,
  } = useOpenCall();

  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<ReplyRef | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [transfersOpen, setTransfersOpen] = useState(true);
  const listRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const typingTimer = useRef<number | null>(null);

  useEffect(() => {
    const element = listRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages.length, typing]);

  useEffect(
    () => () => {
      if (typingTimer.current !== null) window.clearTimeout(typingTimer.current);
    },
    [],
  );

  const activeTransfers = useMemo(() => transfers.slice(-6).reverse(), [transfers]);

  const onDraftChange = (value: string) => {
    setDraft(value);
    sendTyping(true);
    if (typingTimer.current !== null) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => sendTyping(false), 2200);
  };

  const submit = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    setEmojiOpen(false);
    const reference = replyTo;
    setReplyTo(null);
    sendTyping(false);
    await sendMessage(text, reference ?? undefined);
  };

  const copyMessage = async (message: ChatMessage) => {
    try {
      await navigator.clipboard?.writeText(message.text);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <section className="panel flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="relative flex shrink-0 items-center gap-3 border-b border-ink-800/70 bg-ink-900/60 px-3 py-2 sm:px-4">
        <button
          type="button"
          onClick={() => setDetailsOpen(true)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className="avatar">
            {peerLabel.slice(0, 1).toUpperCase()}
            <span className={`avatar-dot ${status === 'connected' ? 'avatar-dot-on' : ''}`} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-ink-100">{peerLabel}</span>
            <span className="block truncate text-[11px] text-ink-400">
              {typing ? 'typing…' : CONNECTION_HINT[status] ?? `${messages.length} message${messages.length === 1 ? '' : 's'}`}
            </span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton
            icon={call.active && call.kind === 'audio' ? 'phone-off' : 'phone'}
            label={call.active && call.kind === 'audio' ? 'Voice call in progress' : 'Start voice call'}
            active={call.active}
            disabled={!canCall}
            onClick={() => void startVoiceCall()}
          />
          <IconButton
            icon="video"
            label="Start video call"
            active={call.active && call.kind === 'video'}
            disabled={!canCall}
            onClick={() => void startVideoCall()}
          />
          <IconButton icon="more" label="Session options" onClick={() => setMenuOpen((prev) => !prev)} />
        </div>

        {menuOpen ? (
          <>
            <button
              type="button"
              aria-label="Close menu"
              className="fixed inset-0 z-30 cursor-default"
              onClick={() => setMenuOpen(false)}
            />
            <div className="theme-menu">
            <button
              type="button"
              className="list-row"
              onClick={() => {
                setMenuOpen(false);
                setDetailsOpen(true);
              }}
            >
              <Icon name="activity" className="h-4 w-4 text-ink-400" />
              <span className="flex-1 text-sm text-ink-100">Connection details</span>
            </button>
            <button
              type="button"
              className="list-row"
              disabled={!messages.length}
              onClick={() => {
                setMenuOpen(false);
                clearConversation();
              }}
            >
              <Icon name="trash" className="h-4 w-4 text-ink-400" />
              <span className="flex-1 text-sm text-ink-100">Clear conversation</span>
            </button>
            <button
              type="button"
              className="list-row"
              disabled={call.active}
              onClick={() => {
                setMenuOpen(false);
                disconnect();
              }}
            >
              <Icon name="power" className="h-4 w-4 text-bad" />
              <span className="flex-1 text-sm text-bad">End session</span>
            </button>
            </div>
          </>
        ) : null}
      </header>

      {detailsOpen ? (
        <div className="fixed inset-0 z-30 flex bg-ink-950/80 p-3 backdrop-blur-sm">
          <SidePanel onClose={() => setDetailsOpen(false)} />
        </div>
      ) : null}

      {activeTransfers.length ? (
        <div className="shrink-0 border-b border-ink-800/70 px-3 py-2">
          <button
            type="button"
            className="mb-2 flex w-full items-center justify-between text-[11px] font-medium text-ink-400"
            onClick={() => setTransfersOpen((prev) => !prev)}
          >
            <span>File transfers ({activeTransfers.length})</span>
            <Icon name={transfersOpen ? 'chevron-left' : 'chevron-right'} className="h-3.5 w-3.5" />
          </button>
          {transfersOpen ? (
            <div className="space-y-2">
              {activeTransfers.map((transfer) => (
                <TransferRow key={transfer.id} transfer={transfer} onCancel={cancelTransfer} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div ref={listRef} className="chat-canvas min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4">
        {messages.length === 0 ? (
          <Empty icon="send" title="Say hello" hint="Direct device to device." />
        ) : (
          messages.map((message, index) => {
            const previous = messages[index - 1];
            const next = messages[index + 1];
            const newDay = !previous || !sameDay(previous.ts, message.ts);
            const runStart = newDay || !previous || previous.sender !== message.sender;
            const lastOfRun = !next || next.sender !== message.sender || !sameDay(next.ts, message.ts);
            const mine = message.sender === 'local';

            return (
              <Fragment key={message.id}>
                {newDay ? (
                  <div className="my-3 flex justify-center first:mt-0">
                    <span className="chat-day">{dayLabel(message.ts)}</span>
                  </div>
                ) : null}

                {message.sender === 'system' ? (
                  <div className="my-2 flex justify-center">
                    <span className="chat-day">{message.text}</span>
                  </div>
                ) : (
                  <div className={`group flex gap-2 ${runStart ? 'mt-2' : 'mt-0.5'} ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`flex max-w-[86%] flex-col sm:max-w-[70%] ${mine ? 'items-end' : 'items-start'}`}>
                      <div
                        className={`bubble ${mine ? 'bubble-out' : 'bubble-in'} ${
                          lastOfRun ? 'bubble-tail' : ''
                        } px-3 py-2 shadow-card`}
                      >
                        {message.replyTo ? (
                          <div className="bubble-quote mb-1.5 border-l-2 border-accent/70 px-2 py-1">
                            <p className="bubble-quote-name text-[10px] font-medium">
                              {message.replyTo.sender === 'local' ? 'You' : peerLabel}
                            </p>
                            <p className="bubble-quote-text truncate text-[11px]">{message.replyTo.text}</p>
                          </div>
                        ) : null}
                        <p className="whitespace-pre-wrap break-words">
                          {message.text}
                          <span
                            className="bubble-meta ml-2 inline-flex translate-y-[2px] items-center gap-1 whitespace-nowrap text-[10px] tabular-nums"
                            title={mine ? DELIVERY_LABEL[message.delivery] : undefined}
                          >
                            {formatClock(message.ts)}
                            {mine ? <DeliveryMark delivery={message.delivery} /> : null}
                          </span>
                        </p>
                      </div>

                      {/* Touch keeps these visible; a pointer reveals them on hover. */}
                      <div className="mt-1 flex items-center gap-3 px-1 text-ink-500 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                        <button
                          type="button"
                          title="Reply"
                          className="transition-colors hover:text-ink-200"
                          onClick={() =>
                            setReplyTo({
                              id: message.id,
                              text: message.text.slice(0, 120),
                              sender: mine ? 'local' : 'remote',
                            })
                          }
                        >
                          <Icon name="reply" className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          title="Copy"
                          className="transition-colors hover:text-ink-200"
                          onClick={() => void copyMessage(message)}
                        >
                          <Icon name="copy" className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          title="Remove from this device"
                          className="transition-colors hover:text-bad"
                          onClick={() => deleteMessage(message.id)}
                        >
                          <Icon name="trash" className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </Fragment>
            );
          })
        )}

        {typing ? (
          <div className="mt-2 flex justify-start">
            <span className="bubble bubble-in flex items-center gap-1 px-3.5 py-2.5">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-400" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-400 [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-400 [animation-delay:300ms]" />
            </span>
          </div>
        ) : null}
      </div>

      <footer className="shrink-0 border-t border-ink-800/70 px-3 py-3">
        {replyTo ? (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border-l-2 border-accent/70 bg-ink-850 px-3 py-1.5">
            <div className="min-w-0">
              <p className="text-[10px] font-medium text-ink-400">
                Replying to {replyTo.sender === 'local' ? 'yourself' : peerLabel}
              </p>
              <p className="truncate text-[11px] text-ink-300">{replyTo.text}</p>
            </div>
            <IconButton icon="x" label="Cancel reply" onClick={() => setReplyTo(null)} />
          </div>
        ) : null}

        {emojiOpen ? (
          <div className="mb-2 grid grid-cols-10 gap-1 rounded-2xl border border-ink-800 bg-ink-850 p-2">
            {EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="rounded-lg p-1 text-lg transition-colors hover:bg-ink-750"
                onClick={() => {
                  setDraft((prev) => prev + emoji);
                  setEmojiOpen(false);
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        ) : null}

        <div className="composer">
          <IconButton
            icon="clip"
            label="Attach files"
            className="icon-btn-plain composer-btn"
            disabled={!canCall}
            onClick={() => fileRef.current?.click()}
          />
          <textarea
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            rows={1}
            placeholder={canCall ? `Message ${peerLabel}…` : 'Waiting for the connection…'}
            className="composer-input"
          />
          <IconButton
            icon="smile"
            label="Insert emoji"
            className={`icon-btn-plain composer-btn ${emojiOpen ? 'composer-btn-on' : ''}`}
            onClick={() => setEmojiOpen((prev) => !prev)}
          />
          <button
            type="button"
            className="send-btn"
            aria-label="Send message"
            onClick={() => void submit()}
            disabled={!draft.trim() || !canCall}
          >
            <Icon name="send" className="h-4 w-4" />
          </button>
        </div>

        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            if (event.target.files?.length) void sendFiles(event.target.files);
            event.target.value = '';
          }}
        />
      </footer>
    </section>
  );
}
