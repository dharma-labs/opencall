import { checksum, gunzipFromBase64Url, gzipToBase64Url } from '../../utils';

/** Single-part marker for the packed format: dictionary pass, gzip, base64url. */
const PREFIX = 'OC2';
/** Marker for the earlier gzip-only format. Still decoded so older codes keep working. */
const LEGACY_PREFIX = 'OC1';
/** Multi-part payload marker: `OC1C.<index>.<total>.<checksum>:<chunk>`. */
const CHUNK_PREFIX = 'OC1C';

export const MAX_PAYLOAD_CHARS = 200_000;
/**
 * Characters per QR code. Once the dictionary pass and gzip have run, a Chrome
 * offer for audio, video and two data channels lands around 1,000–1,600
 * characters, so one code per device is the normal case rather than the
 * exception. A code this size is dense but still scans from a phone screen
 * held a hand's width away.
 */
export const DEFAULT_QR_CHARS = 1800;
export const MAX_QR_PARTS = 40;

/**
 * SDP is enormously repetitive: a couple of dozen attribute names and codec
 * constants carry the whole document. Swapping them for single control
 * characters before gzip — and reversing that afterwards — is lossless, and it
 * is what brings a handshake down to a single QR code. The payload is JSON, and
 * JSON.stringify escapes control characters, so none of these bytes can occur
 * in the input. The array holds 31 entries so every token fits the 1..31 range.
 */
const SDP_DICTIONARY = [
  'http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01',
  'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f',
  'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time',
  'urn:ietf:params:rtp-hdrext:',
  'a=fingerprint:sha-256',
  'urn:3gpp:video-orientation',
  'a=msid-semantic: WMS',
  'UDP/DTLS/SCTP webrtc-datachannel',
  'a=max-message-size:262144',
  'telephone-event/48000',
  'a=ice-options:trickle',
  'a=extmap-allow-mixed',
  'UDP/TLS/RTP/SAVPF',
  'a=sctp-port:5000',
  'a=setup:actpass',
  'a=setup:passive',
  'a=setup:active',
  'a=group:BUNDLE',
  'a=candidate:',
  'a=ice-ufrag:',
  'a=rtcp-fb:',
  'a=ice-pwd:',
  'a=rtcp-mux',
  'a=rtpmap:',
  'typ srflx',
  'typ host',
  'a=extmap:',
  'a=fmtp:',
  'a=msid:',
  'a=ssrc:',
  'a=mid:',
].sort((a, b) => b.length - a.length);

function applyDictionary(text: string): string {
  let out = text;
  SDP_DICTIONARY.forEach((token, index) => {
    if (out.includes(token)) out = out.split(token).join(String.fromCharCode(index + 1));
  });
  return out;
}

function removeDictionary(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const slot = text.charCodeAt(i) - 1;
    out += slot >= 0 && slot < SDP_DICTIONARY.length ? SDP_DICTIONARY[slot] : text[i];
  }
  return out;
}

export interface SessionDescriptionLike {
  type: 'offer' | 'answer';
  sdp: string;
}

export interface SignalPayload {
  v: 1;
  kind: 'offer' | 'answer';
  session: string;
  created: number;
  agent: string;
  sdp: SessionDescriptionLike;
}

export function createSignal(
  kind: 'offer' | 'answer',
  session: string,
  sdp: SessionDescriptionLike,
): SignalPayload {
  return {
    v: 1,
    kind,
    session,
    created: Date.now(),
    agent: 'opencall/1.0',
    sdp: { type: sdp.type, sdp: sdp.sdp },
  };
}

function validate(value: unknown): SignalPayload {
  if (!value || typeof value !== 'object') throw new Error('Connection data is not a valid OpenCall payload.');
  const payload = value as Partial<SignalPayload>;
  if (payload.v !== 1) throw new Error('Unsupported connection data version.');
  if (payload.kind !== 'offer' && payload.kind !== 'answer') throw new Error('Connection data kind is invalid.');
  if (typeof payload.session !== 'string' || payload.session.length < 4) throw new Error('Connection data session id is missing.');
  const sdp = payload.sdp as SessionDescriptionLike | undefined;
  if (!sdp || typeof sdp.sdp !== 'string' || sdp.sdp.length < 20) throw new Error('Connection data has no usable SDP.');
  if (sdp.type !== payload.kind) throw new Error('Connection data SDP type does not match its kind.');
  if (payload.created && typeof payload.created !== 'number') throw new Error('Connection data timestamp is invalid.');
  return {
    v: 1,
    kind: payload.kind,
    session: payload.session,
    created: payload.created ?? Date.now(),
    agent: typeof payload.agent === 'string' ? payload.agent : 'unknown',
    sdp: { type: sdp.type, sdp: sdp.sdp },
  };
}

/** Serialises + compresses an SDP payload into a transferable ASCII string. */
export async function encodeSignal(payload: SignalPayload): Promise<string> {
  const json = JSON.stringify(payload);
  if (json.length > MAX_PAYLOAD_CHARS) {
    throw new Error('Connection data is larger than the supported limit.');
  }
  const body = await gzipToBase64Url(applyDictionary(json));
  return `${PREFIX}:${body}`;
}

export async function decodeSignal(text: string): Promise<SignalPayload> {
  const trimmed = text.trim();
  const separator = trimmed.indexOf(':');
  if (separator <= 0) throw new Error('Unrecognised connection data.');
  const prefix = trimmed.slice(0, separator);
  if (prefix !== PREFIX && prefix !== LEGACY_PREFIX) throw new Error('Unrecognised connection data format.');
  const inflated = await gunzipFromBase64Url(trimmed.slice(separator + 1));
  const json = prefix === PREFIX ? removeDictionary(inflated) : inflated;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Connection data is corrupted.');
  }
  return validate(parsed);
}

export function looksLikeSignal(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.startsWith(`${PREFIX}:`) ||
    trimmed.startsWith(`${LEGACY_PREFIX}:`) ||
    trimmed.startsWith(`${CHUNK_PREFIX}.`)
  );
}

/**
 * A link that carries the handshake in the fragment. Fragment data never
 * reaches a web server, so pasting a link into a chat app does not hand the
 * session description to whoever serves the page. Returns `null` for the
 * packaged desktop and mobile builds, which have no shareable origin.
 */
export function buildShareLink(payload: string): string | null {
  if (typeof window === 'undefined') return null;
  const { protocol, origin, pathname } = window.location;
  if (protocol !== 'http:' && protocol !== 'https:') return null;
  return `${origin}${pathname}#oc=${payload}`;
}

/** Recovers a payload from a share link, or passes a bare payload straight through. */
export function readShareLink(text: string): string | null {
  const value = text.trim();
  const match = /[#?&]oc=([A-Za-z0-9._:\-]+)/.exec(value);
  if (match) return match[1];
  return looksLikeSignal(value) ? value : null;
}

/** Splits a payload into QR-sized parts. Single-part payloads are returned as-is. */
export function splitForQr(payload: string, maxChars = DEFAULT_QR_CHARS): string[] {
  if (payload.length <= maxChars) return [payload];
  const size = Math.max(200, maxChars);
  const total = Math.ceil(payload.length / size);
  if (total > MAX_QR_PARTS) {
    throw new Error(
      `Connection data needs ${total} QR codes which exceeds the ${MAX_QR_PARTS}-part limit. Use copy/paste or the JSON export instead.`,
    );
  }
  const sum = checksum(payload);
  const parts: string[] = [];
  for (let i = 0; i < total; i += 1) {
    parts.push(`${CHUNK_PREFIX}.${i + 1}.${total}.${sum}:${payload.slice(i * size, (i + 1) * size)}`);
  }
  return parts;
}

export interface ChunkPart {
  index: number;
  total: number;
  checksum: string;
  data: string;
}

export function parseChunkPart(part: string): ChunkPart | null {
  if (!part.startsWith(`${CHUNK_PREFIX}.`)) return null;
  const separator = part.indexOf(':');
  if (separator < 0) return null;
  const header = part.slice(CHUNK_PREFIX.length + 1, separator).split('.');
  if (header.length !== 3) return null;
  const index = Number.parseInt(header[0], 10);
  const total = Number.parseInt(header[1], 10);
  if (!Number.isFinite(index) || !Number.isFinite(total) || index < 1 || total < 1) return null;
  return { index, total, checksum: header[2], data: part.slice(separator + 1) };
}

/** Reassembles a set of scanned parts into the original payload, verifying integrity. */
export function joinQrParts(parts: string[]): string {
  const trimmed = parts.map((part) => part.trim()).filter(Boolean);
  if (!trimmed.length) throw new Error('No connection data was provided.');

  const single = trimmed.find((part) => part.startsWith(`${PREFIX}:`));
  if (single && trimmed.length === 1) return single;

  const chunks: ChunkPart[] = [];
  for (const part of trimmed) {
    const chunk = parseChunkPart(part);
    if (chunk) chunks.push(chunk);
  }
  if (!chunks.length) {
    if (single) return single;
    throw new Error('Unrecognised connection data.');
  }

  const total = chunks[0].total;
  const unique = new Map<number, ChunkPart>();
  for (const chunk of chunks) {
    if (chunk.total !== total) throw new Error('Connection data parts come from different exchanges.');
    unique.set(chunk.index, chunk);
  }
  if (unique.size !== total) {
    throw new Error(`Incomplete connection data: received ${unique.size} of ${total} parts.`);
  }

  const ordered = Array.from(unique.values()).sort((a, b) => a.index - b.index);
  const joined = ordered.map((chunk) => chunk.data).join('');
  if (checksum(joined) !== ordered[0].checksum) {
    throw new Error('Connection data failed its integrity check. Please scan again.');
  }
  return joined;
}

export interface DiagnosticSummary {
  bytes: number;
  parts: number;
  session: string;
  kind: 'offer' | 'answer';
}

export async function summariseSignal(payload: string): Promise<DiagnosticSummary> {
  const decoded = await decodeSignal(payload);
  return { bytes: payload.length, parts: splitForQr(payload).length, session: decoded.session, kind: decoded.kind };
}

/** Download helper for the JSON export fallback. */
export function downloadSignalFile(payload: string, filename: string): void {
  const blob = new Blob([JSON.stringify({ opencall: 1, payload }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Reads a JSON export (or a raw payload pasted into a file). */
export async function readSignalFile(file: File): Promise<string> {
  const text = await file.text();
  if (looksLikeSignal(text)) return text.trim();
  try {
    const parsed = JSON.parse(text) as { payload?: unknown };
    if (typeof parsed.payload === 'string') return parsed.payload;
  } catch {
    /* not JSON */
  }
  throw new Error('The selected file does not contain OpenCall connection data.');
}
