import type { Diagnostics, Preferences } from '../../types';

/**
 * ICE configuration.
 *
 * Public STUN lets two devices on different networks learn their public address
 * and hole-punch a direct path. Several servers are listed because a single one
 * is a single point of failure: name resolution for STUN hosts was measured to
 * error on the first attempt and succeed on a later one, so redundancy is what
 * makes the first pairing attempt land.
 *
 * There is no built-in TURN relay. Every free public relay checked from this
 * network is dead (`turn.manual.to` refuses the connection, OpenRelay allocates
 * nothing), and a broken relay in the list stalls a handshake that would
 * otherwise connect. To traverse a symmetric NAT, put your own coturn entry in
 * Settings → Connection; it is used verbatim.
 */
export const PUBLIC_STUN_URLS = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
  'stun:stun.nextcloud.com:443',
  'stun:global.stun.twilio.com:3478',
];

export type IcePlanInput = Pick<Preferences, 'usePublicStun' | 'customIceServers'>;

function normaliseUrl(value: string): string {
  return /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `stun:${value}`;
}

/**
 * Parses the Settings field: one server per line, comments with `#`.
 *
 *   stun:stun.example.org:3478
 *   turn:turn.example.org:3478|username|credential
 *   turn:one.example:3478,turn:two.example:3478|username|credential
 */
export function parseIceServers(text: string): RTCIceServer[] {
  const servers: RTCIceServer[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const [urlPart, username, credential] = line.split('|').map((piece) => piece.trim());
    const urls = (urlPart ?? '')
      .split(',')
      .map((piece) => piece.trim())
      .filter(Boolean)
      .map(normaliseUrl);
    if (!urls.length) continue;
    servers.push(username ? { urls, username, credential: credential ?? '' } : { urls });
  }
  return servers;
}

export function buildIceConfig(input: IcePlanInput): RTCConfiguration {
  const iceServers: RTCIceServer[] = [];
  if (input.usePublicStun) iceServers.push({ urls: PUBLIC_STUN_URLS });
  iceServers.push(...parseIceServers(input.customIceServers));
  return {
    iceServers,
    // No candidate pool: gathering starts when the peer connection is built, so
    // the STUN attempts are spent against a peer that actually exists.
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
  };
}

/** Human-readable summary of what an ICE configuration will actually do. */
export function describeIcePlan(config: RTCConfiguration): string {
  const urls = (config.iceServers ?? []).flatMap((server) =>
    Array.isArray(server.urls) ? server.urls : [server.urls],
  );
  if (!urls.length) return 'No servers — both devices must share a network';
  const stun = urls.filter((url) => url.startsWith('stun:')).length;
  const turn = urls.filter((url) => url.startsWith('turn')).length;
  const parts: string[] = [];
  if (stun) parts.push(`${stun} STUN`);
  if (turn) parts.push(`${turn} TURN relay`);
  return parts.length ? `Using ${parts.join(' + ')}` : 'No servers';
}

export const ICE_GATHERING_TIMEOUT_MS = 6000;

export function createPeerConnection(config: RTCConfiguration): RTCPeerConnection {
  return new RTCPeerConnection(config);
}

/** Resolves when ICE gathering finished (or after `timeoutMs` as a safety net). */
export function waitForIceGathering(pc: RTCPeerConnection, timeoutMs = ICE_GATHERING_TIMEOUT_MS): Promise<boolean> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (complete: boolean) => {
      if (settled) return;
      settled = true;
      pc.removeEventListener('icegatheringstatechange', onStateChange);
      pc.removeEventListener('icecandidate', onCandidate);
      clearTimeout(timer);
      resolve(complete);
    };
    const onStateChange = () => {
      if (pc.iceGatheringState === 'complete') finish(true);
    };
    const onCandidate = (event: RTCPeerConnectionIceEvent) => {
      if (!event.candidate) finish(true);
    };
    const timer = setTimeout(() => finish(pc.iceGatheringState === 'complete'), timeoutMs);
    pc.addEventListener('icegatheringstatechange', onStateChange);
    pc.addEventListener('icecandidate', onCandidate);
  });
}

/** Extracts the candidate types present in an SDP blob, e.g. `{ host: 3 }`. */
export function countCandidateTypes(sdp: string): Record<string, number> {
  const counts: Record<string, number> = {};
  const regex = /a=candidate:[^\s]+ \d+ (\S+) \d+ (\S+) \d+ typ (\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(sdp)) !== null) {
    const type = match[3];
    counts[type] = (counts[type] ?? 0) + 1;
  }
  return counts;
}

export function primaryCandidateType(sdp: string): string | null {
  const counts = countCandidateTypes(sdp);
  const order = ['host', 'prflx', 'srflx', 'relay'];
  const found = order.filter((type) => counts[type]);
  if (!found.length) return null;
  return found.join('/');
}

export function describeCandidate(candidate: Record<string, unknown> | undefined): string | null {
  if (!candidate) return null;
  const address = typeof candidate.address === 'string' ? candidate.address : null;
  const protocol = typeof candidate.protocol === 'string' ? candidate.protocol : null;
  const port = typeof candidate.port === 'number' ? candidate.port : null;
  if (!address) return protocol;
  return `${address}${port ? `:${port}` : ''}${protocol ? ` ${protocol}` : ''}`;
}

export const EMPTY_DIAGNOSTICS: Diagnostics = {
  connectionState: 'new',
  iceConnectionState: 'new',
  signalingState: 'stable',
  candidateType: null,
  localCandidate: null,
  remoteCandidate: null,
  rtt: null,
  packetsLost: null,
  jitter: null,
  audioBitrate: null,
  videoBitrate: null,
  videoResolution: null,
  frameRate: null,
  updatedAt: 0,
};
