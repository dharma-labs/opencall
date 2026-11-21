import { describe, expect, it } from 'vitest';
import {
  buildShareLink,
  createSignal,
  DEFAULT_QR_CHARS,
  decodeSignal,
  encodeSignal,
  joinQrParts,
  looksLikeSignal,
  parseChunkPart,
  readShareLink,
  splitForQr,
} from './SignalingManager';

const SDP = [
  'v=0',
  'o=- 123456 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0 1',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'a=mid:0',
  'a=candidate:1 1 udp 2113937151 192.168.1.24 51234 typ host generation 0',
  'm=video 9 UDP/TLS/RTP/SAVPF 96',
  'a=mid:1',
  'a=candidate:2 1 udp 2113937151 192.168.1.24 51235 typ host generation 0',
].join('\r\n');

const offer = () => createSignal('offer', 'session-1234', { type: 'offer', sdp: SDP });

const FINGERPRINT = Array.from({ length: 32 }, (_, i) => (i % 2 ? 'AB' : '4F')).join(':');

/** What Chrome actually produces for one audio track, one video track, two data channels. */
const REALISTIC_SDP = [
  'v=0',
  'o=- 8382537009486833893 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0 1 2 3',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS stream0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 63 9 0 8 110 112 113 126',
  'c=IN IP4 0.0.0.0',
  'a=rtcp:9 IN IP4 0.0.0.0',
  'a=ice-ufrag:8kQ2',
  'a=ice-pwd:9vV1xYq4mC7pLbN0zR2sT5uW',
  'a=ice-options:trickle',
  `a=fingerprint:sha-256 ${FINGERPRINT}`,
  'a=setup:actpass',
  'a=mid:0',
  'a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level',
  'a=extmap:2 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01',
  'a=extmap:3 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time',
  'a=extmap:4 urn:ietf:params:rtp-hdrext:sdes:mid',
  'a=sendrecv',
  'a=msid:stream0 audio0',
  'a=rtcp-mux',
  'a=rtpmap:111 opus/48000/2',
  'a=rtcp-fb:111 transport-cc',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'a=rtpmap:63 red/48000/2',
  'a=fmtp:63 111/111',
  'a=rtpmap:9 G722/8000',
  'a=rtpmap:0 PCMU/8000',
  'a=rtpmap:8 PCMA/8000',
  'a=rtpmap:110 telephone-event/48000',
  'a=rtpmap:112 telephone-event/8000',
  'a=rtpmap:126 telephone-event/8000',
  'a=ssrc:1234567890 cname:abcdefghijklmnop',
  'm=video 9 UDP/TLS/RTP/SAVPF 96 97 98 99 100 101 102 121 127 120 125 107 108 109 124 119 123 118 114 115 116',
  'c=IN IP4 0.0.0.0',
  'a=rtcp:9 IN IP4 0.0.0.0',
  'a=ice-ufrag:8kQ2',
  'a=ice-pwd:9vV1xYq4mC7pLbN0zR2sT5uW',
  'a=ice-options:trickle',
  `a=fingerprint:sha-256 ${FINGERPRINT}`,
  'a=setup:actpass',
  'a=mid:1',
  'a=extmap:14 urn:ietf:params:rtp-hdrext:toffset',
  'a=extmap:2 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01',
  'a=extmap:13 urn:3gpp:video-orientation',
  'a=extmap:4 urn:ietf:params:rtp-hdrext:sdes:mid',
  'a=sendrecv',
  'a=msid:stream0 video0',
  'a=rtcp-mux',
  'a=rtcp-rsize',
  'a=rtpmap:96 VP8/90000',
  'a=rtcp-fb:96 goog-remb',
  'a=rtcp-fb:96 transport-cc',
  'a=rtcp-fb:96 ccm fir',
  'a=rtcp-fb:96 nack',
  'a=rtcp-fb:96 nack pli',
  'a=rtpmap:97 rtx/90000',
  'a=fmtp:97 apt=96',
  'a=rtpmap:98 VP9/90000',
  'a=fmtp:98 profile-id=0',
  'a=rtpmap:121 rtx/90000',
  'a=fmtp:121 apt=98',
  'a=rtpmap:127 H264/90000',
  'a=fmtp:127 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f',
  'a=rtpmap:120 rtx/90000',
  'a=fmtp:120 apt=127',
  'a=ssrc:9876543210 cname:abcdefghijklmnop',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=ice-ufrag:8kQ2',
  'a=ice-pwd:9vV1xYq4mC7pLbN0zR2sT5uW',
  'a=ice-options:trickle',
  `a=fingerprint:sha-256 ${FINGERPRINT}`,
  'a=setup:actpass',
  'a=mid:2',
  'a=sctp-port:5000',
  'a=max-message-size:262144',
  // One host and one server-reflexive candidate per stream, as STUN produces.
  'a=candidate:1467250027 1 udp 2122260223 192.168.1.24 52032 typ host generation 0 network-id 1',
  'a=candidate:1820506189 1 udp 1686052607 203.0.113.77 52032 typ srflx raddr 192.168.1.24 rport 52032 generation 0 network-id 1',
  'a=candidate:1467250028 1 udp 2122194687 2001:db8::1 52033 typ host generation 0 network-id 2',
  'a=candidate:1467250029 1 tcp 1518280447 192.168.1.24 9 typ host tcptype active generation 0 network-id 1',
  'a=candidate:3052686118 1 udp 2122262783 10.0.0.7 41092 typ host generation 0 network-id 3',
].join('\r\n');

describe('SignalingManager', () => {
  it('round-trips an offer payload through compression and validation', async () => {
    const encoded = await encodeSignal(offer());
    expect(looksLikeSignal(encoded)).toBe(true);
    const decoded = await decodeSignal(encoded);
    expect(decoded.kind).toBe('offer');
    expect(decoded.session).toBe('session-1234');
    expect(decoded.sdp.sdp).toBe(SDP);
  });

  it('compresses a realistic Chrome offer into a single QR code', async () => {
    const signal = createSignal('offer', 'session-9876', { type: 'offer', sdp: REALISTIC_SDP });
    const encoded = await encodeSignal(signal);
    expect(encoded.length).toBeLessThan(DEFAULT_QR_CHARS);
    expect(splitForQr(encoded).length).toBe(1);

    const decoded = await decodeSignal(encoded);
    expect(decoded.sdp.sdp).toBe(REALISTIC_SDP);
  });

  it('keeps small payloads in a single QR code', async () => {
    const encoded = await encodeSignal(offer());
    const parts = splitForQr(encoded);
    expect(parts.length).toBe(1);
    expect(joinQrParts(parts)).toBe(encoded);
  });

  it('splits, scans out of order and rejoins large payloads', async () => {
    const encoded = await encodeSignal(offer());
    const parts = splitForQr(encoded, 220);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => parseChunkPart(part) !== null)).toBe(true);

    const shuffled = [...parts].reverse();
    const joined = joinQrParts(shuffled);
    expect(joined).toBe(encoded);

    const decoded = await decodeSignal(joined);
    expect(decoded.sdp.sdp).toBe(SDP);
  });

  it('rejects incomplete sets and corrupted parts', async () => {
    const encoded = await encodeSignal(offer());
    const parts = splitForQr(encoded, 220);
    expect(() => joinQrParts(parts.slice(0, parts.length - 1))).toThrow(/Incomplete/);

    const tampered = [...parts];
    const header = tampered[0].indexOf(':') + 1;
    tampered[0] = `${tampered[0].slice(0, header)}${tampered[0].slice(header, header + 8)}XXXX`;
    expect(() => joinQrParts(tampered)).toThrow(/integrity|Unrecognised/i);
  });

  it('rejects payloads that are not OpenCall data', async () => {
    expect(looksLikeSignal('hello world')).toBe(false);
    await expect(decodeSignal('OC1:not-base64!!')).rejects.toThrow();
    await expect(decodeSignal('random text')).rejects.toThrow(/Unrecognised/);
  });

  it('reads a payload back out of a share link, and leaves a bare payload alone', async () => {
    const encoded = await encodeSignal(offer());
    expect(readShareLink(`https://opencall.example/#oc=${encoded}`)).toBe(encoded);
    expect(readShareLink(encoded)).toBe(encoded);
    expect(readShareLink('https://opencall.example/')).toBeNull();
    // Node has no shareable origin, so no link is offered there.
    expect(buildShareLink(encoded)).toBeNull();
  });
});
