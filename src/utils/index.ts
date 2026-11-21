/**
 * Small, dependency-free helpers. Everything here relies on browser-native APIs.
 */

export const uid = (): string => {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

export const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

/* ------------------------------------------------------------------ encoding */

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export const toBase64Url = (b64: string): string =>
  b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const fromBase64Url = (value: string): string => {
  const normalised = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalised.length % 4;
  return pad === 0 ? normalised : normalised + '='.repeat(4 - pad);
};

export const utf8Encode = (value: string): Uint8Array => new TextEncoder().encode(value);
export const utf8Decode = (value: Uint8Array): string => new TextDecoder().decode(value);

/** Cast helper: keeps TypeScript happy about ArrayBufferLike vs BufferSource. */
export const asBuffer = (bytes: Uint8Array): BufferSource => bytes as unknown as BufferSource;

/* ------------------------------------------------------------------ compression */

type AnyCtor = new (...args: never[]) => unknown;

const getCtor = (name: string): AnyCtor | null => {
  const value = (globalThis as unknown as Record<string, unknown>)[name];
  return typeof value === 'function' ? (value as AnyCtor) : null;
};

export const hasCompression = (): boolean =>
  getCtor('CompressionStream') !== null && getCtor('DecompressionStream') !== null;

export async function gzipToBase64Url(text: string): Promise<string> {
  const input = utf8Encode(text);
  const Ctor = getCtor('CompressionStream');
  if (!Ctor || typeof Response === 'undefined') return toBase64Url(bytesToBase64(input));
  const stream = new Blob([input as unknown as BlobPart])
    .stream()
    .pipeThrough(new (Ctor as unknown as typeof CompressionStream)('gzip'));
  const buffer = await new Response(stream).arrayBuffer();
  return toBase64Url(bytesToBase64(new Uint8Array(buffer)));
}

export async function gunzipFromBase64Url(data: string): Promise<string> {
  const bytes = base64ToBytes(fromBase64Url(data));
  const Ctor = getCtor('DecompressionStream');
  if (!Ctor) return utf8Decode(bytes);
  try {
    const stream = new Blob([bytes as unknown as BlobPart])
      .stream()
      .pipeThrough(new (Ctor as unknown as typeof DecompressionStream)('gzip'));
    const buffer = await new Response(stream).arrayBuffer();
    return utf8Decode(new Uint8Array(buffer));
  } catch {
    // Payload was not compressed (older build or compressed stream unavailable).
    return utf8Decode(bytes);
  }
}

/* ------------------------------------------------------------------ hashing */

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? utf8Encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', asBuffer(bytes));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Fast, synchronous, non-cryptographic checksum used only for QR integrity. */
export function checksum(value: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193;
  for (let i = 0; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    h1 = (h1 ^ c) >>> 0;
    h1 = Math.imul(h1, 16777619) >>> 0;
    h2 = (h2 + Math.imul(c + i, 2654435761)) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/* ------------------------------------------------------------------ formatting */

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function formatClock(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

export function shortId(value: string): string {
  return value.replace(/-/g, '').slice(0, 6).toUpperCase();
}
