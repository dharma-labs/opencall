import type { Diagnostics, Preferences } from '../../types';

/**
 * ICE configuration.
 *
 * Public STUN lets two devices on different networks discover their public
 * addresses and hole-punch a direct path. When hole-punching fails — a strict
 * or symmetric NAT, common on mobile carriers — the free TURN relays below are
 * the fallback that actually connects Delhi to Mumbai. A relay only ever sees
 * encrypted SRTP/DTLS packets, and any of them can be swapped for your own
 * server in Settings → Connection.
 */
export const PUBLIC_STUN_URLS = ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'];

/** Community-run coturn instances, reachable over TCP 443, with static credentials. */
export const FREE_RELAY_SERVERS: RTCIceServer[] = [
  {
    urls: [
      'turn:free-1.manual.to:443?transport=tcp',
      'turn:free-2.manual.to:443?transport=tcp',
      'turn:turn.manual.to:443?transport=tcp',
    ],
    username: '99126',
    credential: '1194964836117',
  },
];

export type IcePlanInput = Pick<Preferences, 'usePublicStun' | 'useFreeRelay' | 'customIceServers'>;

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
  if (input.useFreeRelay) iceServers.push(...FREE_RELAY_SERVERS);
  iceServers.push(...parseIceServers(input.customIceServers));
  return {
    iceServers,
    // Gather a couple of candidates ahead of the handshake so a link opens as
    // soon as the other device is seen.
    iceCandidatePoolSize: iceServers.length ? 2 : 0,
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
