/**
 * Link signalling.
 *
 * A shared room code plus a public MQTT broker carried over WebSocket is what
 * turns "send someone a link" into a working call. The broker only ever relays
 * SDP and ICE blobs before the peer connection exists; media, messages and
 * files stay on the WebRTC path and the app-layer key exchange still happens
 * end to end over the data channel.
 */
import mqtt, { type MqttClient } from 'mqtt';

const PROTOCOL = 'oc/v1';

/** Public brokers, dialled at once; the first to answer is used. Both are relay-only and hold nothing. */
export const DEFAULT_BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];

export type SignalKind = 'offer' | 'answer' | 'ice' | 'bye';

export interface PresenceInfo {
  id: string;
  name: string;
  ts: number;
  /** When this device joined the room. Unlike `ts`, it never moves. */
  born?: number;
}

export interface DirectSignal {
  kind: SignalKind;
  from: string;
  data: unknown;
}

export interface BusHandlers {
  onReady?: () => void;
  /** Fires for every retained presence frame so a partner's freshness can be tracked. */
  onPeer?: (peer: PresenceInfo, first: boolean) => void;
  /** `bye` is true when the device said it left; false when we simply stopped hearing it. */
  onPeerGone?: (id: string, bye: boolean) => void;
  onSignal?: (signal: DirectSignal) => void;
  onCrowded?: (count: number) => void;
  onStatus?: (message: string) => void;
  onError?: (message: string) => void;
}

const ROOM_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
/**
 * Presence refreshes every 18 s, so a frame that has not moved in this long came
 * from a tab that was closed, crashed or lost its socket. Retained frames outlive
 * their author on a public broker, and counting them made dead rooms look full:
 * one code reported 9 devices and refused the two real ones.
 */
const PEER_STALE_MS = 45_000;
const PEER_SWEEP_MS = 15_000;
/** Frames that land this soon after subscribing are the broker's retained history. */
const RESTORED_BURST_MS = 400;
/** One broker gets this long before it is treated as silent; the others are dialled meanwhile. */
const BROKER_CONNECT_TIMEOUT_MS = 6000;

/**
 * Short, human-typeable room code. Fresh for every session — see `LinkSession`.
 *
 * `ROOM_ALPHABET` is 32 symbols and each byte feeds one character, so `% 32`
 * costs no entropy here — unlike an alphabet of 31 or 36, where it would quietly
 * make the leading characters likelier.
 */
export function createRoomCode(length = 9): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) out += ROOM_ALPHABET[byte % ROOM_ALPHABET.length];
  return out;
}

function randomId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Invite links carry the room in the URL fragment, which browsers never send to
 * the web server, so hosting the app does not disclose who is calling whom.
 * Inside a packaged shell there is no shareable origin of its own, so the link
 * points at the hosted build instead.
 */
export const PUBLIC_SITE_URL = 'https://dharma-labs.github.io/opencall/';

function isWrappedApp(): boolean {
  const wrapped = window as unknown as {
    Capacitor?: { isNativePlatform?: () => boolean };
    __TAURI_INTERNALS__?: unknown;
  };
  return (
    wrapped.Capacitor?.isNativePlatform?.() === true ||
    wrapped.__TAURI_INTERNALS__ !== undefined ||
    window.location.hostname.endsWith('.localhost') ||
    window.location.protocol === 'opencall:'
  );
}

export function buildRoomLink(room: string, name?: string): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams({ r: room });
  if (name) params.set('n', name.slice(0, 24));
  const fragment = `#${params.toString()}`;
  if (isWrappedApp()) return `${PUBLIC_SITE_URL}${fragment}`;
  const { protocol, origin, pathname } = window.location;
  if (protocol !== 'http:' && protocol !== 'https:') return null;
  return `${origin}${pathname}${fragment}`;
}

export function readRoomFromLocation(): { room: string; name: string | null } | null {
  if (typeof window === 'undefined') return null;
  const source = window.location.hash.replace(/^#/, '') || window.location.search.replace(/^\?/, '');
  if (!source) return null;
  try {
    const params = new URLSearchParams(source);
    const room = params.get('r') || params.get('room');
    if (!room || !/^[a-z0-9-]{4,40}$/i.test(room)) return null;
    const name = params.get('n');
    return { room: room.toLowerCase(), name: name ? name.slice(0, 24) : null };
  } catch {
    return null;
  }
}

export function clearRoomFromLocation(): void {
  try {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  } catch {
    /* some wrapper runtimes block history */
  }
}

/** Stable ordering across both devices so exactly one side creates the offer. */
function sortKey(presence: PresenceInfo): string {
  // `ts` is a heartbeat that both devices keep rewriting, so an election built
  // on it changes hands in the middle of a handshake — measured: the offerer
  // swapped sides 7 s in and the two devices then re-offered at each other.
  // Join time is fixed, and a device that sends none counts as the earliest, so
  // exactly one side offers either way.
  return `${String(presence.born ?? 0).padStart(14, '0')}:${presence.id}`;
}

export class SignalBus {
  readonly self: PresenceInfo;

  private client: MqttClient | null = null;
  private peers = new Map<string, PresenceInfo>();
  private lastSeen = new Map<string, number>();
  private sightings = new Map<string, number>();
  private reported = new Set<string>();
  private joinedAt = Date.now();
  private handler: BusHandlers;
  private room: string;
  private candidates: MqttClient[] = [];
  private failures = 0;
  private brokers: string[];
  private closing = false;
  private ready = false;
  private sweeper = 0;

  constructor(
    room: string,
    displayName: string,
    handlers: BusHandlers = {},
    brokers: string[] = DEFAULT_BROKERS,
  ) {
    this.room = room;
    this.handler = handlers;
    this.brokers = brokers.length ? brokers : DEFAULT_BROKERS;
    const joined = Date.now();
    this.self = { id: randomId(), name: displayName.slice(0, 24) || 'Peer', ts: joined, born: joined };
  }

  get peerTopicRoot(): string {
    return `${PROTOCOL}/${this.room}/p/`;
  }

  connect(): void {
    this.openBroker();
  }

  private openBroker(): void {
    this.handler.onStatus?.('Reaching the link server…');
    // Every broker is tried at once and the first to answer wins. In order was
    // the slow path: a broker that took its time held the handshake for the
    // whole connect timeout, and mqtt.js then re-dialled the same address.
    // Candidates that lose stay dialled until something wins, so a broker that
    // is merely slow is still there when the fast one turns out to be down.
    const candidates: MqttClient[] = [];
    this.candidates = candidates;

    for (const url of this.brokers) {
      const client = mqtt.connect(url, {
        clientId: `oc${randomId()}`,
        keepalive: 20,
        clean: true,
        reconnectPeriod: 2500,
        connectTimeout: BROKER_CONNECT_TIMEOUT_MS,
      });
      candidates.push(client);

      client.on('connect', () => this.settle(client));
      client.on('message', (topic, payload) => {
        if (this.client === client) this.onMessage(topic, payload);
      });
      client.on('reconnect', () => {
        if (this.client !== client) return;
        this.ready = false;
        this.handler.onStatus?.('Link server reconnecting…');
      });
      client.on('close', () => {
        if (this.client === client) this.ready = false;
      });
      client.on('error', (error) => {
        if (this.ready) {
          this.handler.onError?.(error instanceof Error ? error.message : 'Signalling error');
          return;
        }
        // Only speak up once nothing has answered at all; a single candidate
        // failing while the others are still dialling is not news.
        this.failures += 1;
        if (this.failures >= candidates.length && !this.client) {
          this.handler.onError?.(error instanceof Error ? error.message : 'No link server answered.');
        }
      });
    }
  }

  /** The first broker to answer becomes the session; the rest are hung up. */
  private settle(client: MqttClient): void {
    if (this.client) {
      if (client !== this.client) client.end(true);
      return;
    }
    this.client = client;
    for (const other of this.candidates) {
      if (other !== client) other.end(true);
    }
    void this.onConnect(client);
  }

  private async onConnect(client: MqttClient): Promise<void> {
    try {
      await client.subscribe([`${this.peerTopicRoot}#`, `${PROTOCOL}/${this.room}/d/${this.self.id}`], { qos: 0 });
      // Anything seen in a short window from here on arrived as retained history.
      this.joinedAt = Date.now();
      await this.publishPresence();
      this.ready = true;
      window.addEventListener('pagehide', this.onPageHide);
      this.sweeper = window.setInterval(() => this.sweepPeers(), PEER_SWEEP_MS);
      this.handler.onStatus?.('Link is live. Waiting for the other device.');
      this.handler.onReady?.();
    } catch (error) {
      this.handler.onError?.(error instanceof Error ? error.message : 'Could not join the room.');
    }
  }

  private publishPresence(): Promise<void> {
    const client = this.client;
    if (!client) return Promise.resolve();
    return new Promise((resolve) => {
      client.publish(
        `${this.peerTopicRoot}${this.self.id}`,
        JSON.stringify(this.self),
        { qos: 0, retain: true },
        () => resolve(),
      );
    });
  }

  private onMessage(topic: string, payload: Uint8Array): void {
    let text: string;
    try {
      text = new TextDecoder().decode(payload);
    } catch {
      return;
    }

    if (topic.startsWith(this.peerTopicRoot)) {
      const id = topic.slice(this.peerTopicRoot.length);
      if (!id || id === this.self.id) return;
      if (!text) {
        // An empty retained frame is the other device saying it has left.
        if (this.peers.has(id)) {
          this.forget(id);
          this.handler.onPeerGone?.(id, true);
        }
        return;
      }
      let presence: PresenceInfo | null = null;
      try {
        const parsed = JSON.parse(text) as Partial<PresenceInfo>;
        if (typeof parsed.id === 'string' && typeof parsed.ts === 'number') {
          presence = {
            id: parsed.id,
            name: String(parsed.name ?? 'Peer').slice(0, 24),
            ts: parsed.ts,
            born: typeof parsed.born === 'number' ? parsed.born : undefined,
          };
        }
      } catch {
        presence = null;
      }
      if (!presence) return;
      const arrived = Date.now();
      this.peers.set(id, presence);
      this.lastSeen.set(id, arrived);
      const sightings = (this.sightings.get(id) ?? 0) + 1;
      this.sightings.set(id, sightings);

      // A device that is alive follows its first frame with a heartbeat; a frame
      // the broker kept for a tab that is gone never does. Frames that land in
      // the burst right after subscribing are the room's history rather than
      // arrivals, so an unseen id from that burst is held back until it repeats.
      // Judging by arrival, not by `ts`, keeps two devices whose clocks disagree
      // able to see each other — the cost is that a peer which opened the link
      // in the same second as this one is picked up on its next heartbeat.
      if (!this.reported.has(id)) {
        const fromThePast = sightings < 2 && arrived - this.joinedAt <= RESTORED_BURST_MS;
        if (fromThePast) return;
        const crowded = this.provenPeers() + 1;
        if (crowded > 2) {
          this.handler.onCrowded?.(crowded);
          return;
        }
        this.reported.add(id);
        this.handler.onPeer?.(presence, true);
        return;
      }
      this.handler.onPeer?.(presence, false);
      return;
    }

    const direct = /^oc\/v1\/[^/]+\/d\/([^/]+)$/.exec(topic);
    if (!direct) return;
    try {
      const parsed = JSON.parse(text) as { k?: unknown; from?: unknown; d?: unknown };
      if (typeof parsed.from !== 'string' || typeof parsed.k !== 'string') return;
      if (parsed.from === this.self.id) return;
      this.handler.onSignal?.({ kind: parsed.k as SignalKind, from: parsed.from, data: parsed.d });
    } catch {
      /* ignore malformed frames */
    }
  }

  /** True when this device should create the offer, decided from identical data on both sides. */
  electOfferer(peer: PresenceInfo): boolean {
    return sortKey(this.self) < sortKey(peer);
  }

  send(kind: SignalKind, to: string, data: unknown): void {
    const client = this.client;
    if (!client) return;
    client.publish(`${PROTOCOL}/${this.room}/d/${to}`, JSON.stringify({ k: kind, from: this.self.id, d: data }), {
      qos: 1,
    });
  }

  /** Keeps a long-lived room alive so a device that opens the link late still finds it. */
  refresh(): void {
    if (!this.ready) return;
    this.self.ts = Date.now();
    void this.publishPresence();
  }

  /** Devices proven alive: they announced themselves more than once, recently. */
  private provenPeers(): number {
    const now = Date.now();
    let live = 0;
    for (const [id, at] of this.lastSeen) {
      if (now - at > PEER_STALE_MS) continue;
      if ((this.sightings.get(id) ?? 0) < 2) continue;
      live += 1;
    }
    return live;
  }

  /**
   * Forgets devices that stopped announcing themselves and blanks their retained
   * frame so the whole room stops seeing them. Without this, tabs that were
   * closed without a goodbye keep counting toward the two-device limit for as
   * long as the broker retains them — which is how a fresh link reported nine
   * strangers and refused the two real ones.
   */
  private sweepPeers(): void {
    if (!this.client || this.closing) return;
    const now = Date.now();
    for (const [id, at] of this.lastSeen) {
      if (now - at <= PEER_STALE_MS) continue;
      this.forget(id);
      this.eraseGhost(id);
      // Silence is not a goodbye: a backgrounded device throttles its own
      // heartbeat, and its line should stay up on the strength of the data
      // channel. The caller decides what a quiet peer means.
      this.handler.onPeerGone?.(id, false);
    }
  }

  private forget(id: string): void {
    this.peers.delete(id);
    this.lastSeen.delete(id);
    this.sightings.delete(id);
    this.reported.delete(id);
  }

  /** Empties a retained frame so the room stops counting a device that is gone. */
  private eraseGhost(id: string): void {
    const client = this.client;
    if (!client) return;
    try {
      client.publish(`${this.peerTopicRoot}${id}`, '', { qos: 0, retain: true });
    } catch {
      /* the frame simply outlives this attempt */
    }
  }

  /** A tab that vanishes should not leave a ghost behind: say goodbye on the way out. */
  private onPageHide = (): void => {
    const client = this.client;
    if (!client || this.closing) return;
    try {
      client.publish(`${this.peerTopicRoot}${this.self.id}`, '', { qos: 0, retain: true });
    } catch {
      /* best effort during unload */
    }
  };

  close(): void {
    if (this.closing) return;
    this.closing = true;
    if (this.sweeper) window.clearInterval(this.sweeper);
    this.sweeper = 0;
    window.removeEventListener('pagehide', this.onPageHide);
    const client = this.client;
    this.client = null;
    if (client) {
      try {
        client.publish(`${this.peerTopicRoot}${this.self.id}`, '', { qos: 0, retain: true });
        for (const id of this.peers.keys()) {
          // This device is the one leaving, so nobody was told to go elsewhere.
          this.handler.onPeerGone?.(id, false);
        }
      } catch {
        /* best effort */
      }
      this.peers.clear();
      this.lastSeen.clear();
      this.sightings.clear();
      this.reported.clear();
    }
    // Brokers still dialling belong to a session that no longer exists.
    for (const candidate of this.candidates) candidate.end(true);
    this.candidates = [];
    if (client) client.end(true);
  }
}
