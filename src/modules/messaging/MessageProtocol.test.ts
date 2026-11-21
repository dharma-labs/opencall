import { describe, expect, it } from 'vitest';
import {
  MAX_MESSAGE_CHARS,
  PROTOCOL_VERSION,
  buildEncryptedEnvelope,
  buildPlainEnvelope,
  parseEnvelope,
  sanitiseText,
} from './MessageProtocol';

describe('MessageProtocol', () => {
  it('round-trips a plain envelope', () => {
    const envelope = buildPlainEnvelope({ t: 'msg', id: 'm1', text: 'hello', ts: 1 });
    const parsed = parseEnvelope(JSON.stringify(envelope));
    expect(parsed).not.toBeNull();
    expect(parsed?.p).toEqual({ t: 'msg', id: 'm1', text: 'hello', ts: 1 });
  });

  it('round-trips an encrypted envelope without exposing the payload', () => {
    const envelope = buildEncryptedEnvelope('aXY=', 'Y3Q=');
    const parsed = parseEnvelope(JSON.stringify(envelope));
    expect(parsed?.enc).toEqual({ iv: 'aXY=', ct: 'Y3Q=' });
    expect(parsed?.p).toBeUndefined();
  });

  it('rejects malformed, wrong-version and unknown-type envelopes', () => {
    expect(parseEnvelope('not json')).toBeNull();
    expect(parseEnvelope('')).toBeNull();
    expect(parseEnvelope(JSON.stringify({ v: 99, p: { t: 'msg' } }))).toBeNull();
    expect(parseEnvelope(JSON.stringify({ v: PROTOCOL_VERSION, p: { t: 'nope' } }))).toBeNull();
    expect(parseEnvelope(JSON.stringify({ v: PROTOCOL_VERSION }))).toBeNull();
  });

  it('strips control characters and enforces the size limit', () => {
    expect(sanitiseText('a\u0000b\u001fc')).toBe('abc');
    const long = 'x'.repeat(MAX_MESSAGE_CHARS + 500);
    expect(sanitiseText(long).length).toBe(MAX_MESSAGE_CHARS);
  });
});
