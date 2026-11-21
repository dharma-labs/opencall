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

/** Public brokers, tried in order. Both are relay-only and hold nothing. */
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
  onPeerGone?: (id: string) => void;
  onSignal?: (signal: DirectSignal) => void;
  onCrowded?: (count: number) => void;
  onStatus?: (message: string) => void;
  onError?: (message: string) => void;
}

const ROOM_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

/** Short, human-typeable room code. Collisions are irrelevant: an occupied room simply never answers. */
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
  private handler: BusHandlers;
  private room: string;
  private brokerIndex = 0;
  private brokers: string[];
  private closing = false;
  private ready = false;

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
    const url = this.brokers[this.brokerIndex % this.brokers.length];
    this.brokerIndex += 1;
    this.handler.onStatus?.('Reaching the link server…');

    const client = mqtt.connect(url, {
      clientId: `oc${randomId()}`,
      keepalive: 20,
      clean: true,
      reconnectPeriod: 2500,
      connectTimeout: 9000,
    });
    this.client = client;

    client.on('connect', () => {
      void this.onConnect(client);
    });
    client.on('message', (topic, payload) => this.onMessage(topic, payload));
    client.on('reconnect', () => {
      this.ready = false;
      this.handler.onStatus?.('Link server reconnecting…');
    });
    client.on('close', () => {
      this.ready = false;
    });
    client.on('error', (error) => {
      const message = error instanceof Error ? error.message : 'Signalling error';
      // A broker that will not answer is swapped for the next one; anything else
      // is reported and left to mqtt.js's own reconnect loop.
      if (!this.ready && this.brokerIndex < this.brokers.length) {
        this.handler.onStatus?.('Trying a backup link server…');
        client.end(true);
        this.client = null;
        this.openBroker();
      } else {
        this.handler.onError?.(message);
      }
    });
  }

  private async onConnect(client: MqttClient): Promise<void> {
    try {
      await client.subscribe([`${this.peerTopicRoot}#`, `${PROTOCOL}/${this.room}/d/${this.self.id}`], { qos: 0 });
      await this.publishPresence();
      this.ready = true;
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
        if (this.peers.delete(id)) this.handler.onPeerGone?.(id);
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
      const known = this.peers.has(id);
      this.peers.set(id, presence);
      if (known) {
        this.handler.onPeer?.(presence, false);
        return;
      }
      if (this.peers.size > 1) {
        this.handler.onCrowded?.(this.peers.size + 1);
        return;
      }
      this.handler.onPeer?.(presence, true);
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

  close(): void {
    if (this.closing) return;
    this.closing = true;
    const client = this.client;
    this.client = null;
    if (!client) return;
    try {
      client.publish(`${this.peerTopicRoot}${this.self.id}`, '', { qos: 0, retain: true });
      for (const id of this.peers.keys()) {
        this.handler.onPeerGone?.(id);
      }
    } catch {
      /* best effort */
    }
    this.peers.clear();
    client.end(true);
  }
}
