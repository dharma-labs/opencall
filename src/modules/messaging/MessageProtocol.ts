import { uid } from '../../utils';

export const PROTOCOL_VERSION = 1;
export const MAX_MESSAGE_CHARS = 4000;
export const TYPING_TTL_MS = 6000;

export interface ReplyReference {
  id: string;
  text: string;
  sender: 'local' | 'remote';
}

export type InnerMessage =
  | { t: 'hello'; name: string; agent: string; ts: number }
  | { t: 'msg'; id: string; text: string; ts: number; replyTo?: ReplyReference }
  | { t: 'ack'; ids: string[]; ts: number }
  | { t: 'read'; ids: string[]; ts: number }
  | { t: 'typing'; on: boolean; ts: number }
  | { t: 'file-meta'; id: string; slot: number; name: string; size: number; mime: string; chunks: number; ts: number }
  | { t: 'file-done'; id: string; hash: string | null; ts: number }
  | { t: 'file-cancel'; id: string; reason: string; ts: number }
  | { t: 'key'; pub: string; ts: number }
  | { t: 'bye'; ts: number };

export interface Envelope {
  v: number;
  /** Present when the inner message is encrypted. */
  enc?: { iv: string; ct: string };
  /** Present when the inner message is sent in the clear. */
  p?: InnerMessage;
}

export function buildPlainEnvelope(inner: InnerMessage): Envelope {
  return { v: PROTOCOL_VERSION, p: inner };
}

export function buildEncryptedEnvelope(iv: string, ct: string): Envelope {
  return { v: PROTOCOL_VERSION, enc: { iv, ct } };
}

export function parseEnvelope(raw: string): Envelope | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 8 * 1024 * 1024) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const candidate = parsed as Partial<Envelope>;
  if (candidate.v !== PROTOCOL_VERSION) return null;
  if (candidate.enc) {
    const { iv, ct } = candidate.enc;
    if (typeof iv !== 'string' || typeof ct !== 'string') return null;
    return { v: candidate.v, enc: { iv, ct } };
  }
  if (!isInnerMessage(candidate.p)) return null;
  return { v: candidate.v, p: candidate.p };
}

export function isInnerMessage(value: unknown): value is InnerMessage {
  if (!value || typeof value !== 'object') return false;
  const type = (value as { t?: unknown }).t;
  return (
    type === 'hello' ||
    type === 'msg' ||
    type === 'ack' ||
    type === 'read' ||
    type === 'typing' ||
    type === 'file-meta' ||
    type === 'file-done' ||
    type === 'file-cancel' ||
    type === 'key' ||
    type === 'bye'
  );
}

export const chatMessage = (text: string, replyTo?: ReplyReference): InnerMessage => ({
  t: 'msg',
  id: uid(),
  text,
  ts: Date.now(),
  ...(replyTo ? { replyTo } : {}),
});

export const helloMessage = (name: string): InnerMessage => ({
  t: 'hello',
  name,
  agent: 'opencall/1.0',
  ts: Date.now(),
});

export const ackMessage = (ids: string[]): InnerMessage => ({ t: 'ack', ids, ts: Date.now() });
export const readMessage = (ids: string[]): InnerMessage => ({ t: 'read', ids, ts: Date.now() });
export const typingMessage = (on: boolean): InnerMessage => ({ t: 'typing', on, ts: Date.now() });
export const byeMessage = (): InnerMessage => ({ t: 'bye', ts: Date.now() });

/**
 * Normalises inbound chat text: strips control characters, enforces the size limit.
 */
export function sanitiseText(text: string, limit = MAX_MESSAGE_CHARS): string {
  const cleaned = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trimEnd();
  return cleaned.length > limit ? cleaned.slice(0, limit) : cleaned;
}
