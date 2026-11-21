/**
 * Shared domain types for OpenCall.
 */

export type Role = 'host' | 'guest';

export type Phase =
  | 'landing'
  /** Waiting on the link server, or mid-handshake with a device that opened the link. */
  | 'link'
  | 'host-prepare'
  | 'host-wait-answer'
  | 'guest-enter'
  | 'guest-show-answer'
  | 'session';

export type ConnectionStatus =
  | 'idle'
  | 'preparing'
  | 'awaiting-peer'
  | 'connecting'
  | 'connected'
  | 'degraded'
  | 'disconnected'
  | 'failed';

export interface ReplyRef {
  id: string;
  text: string;
  sender: 'local' | 'remote';
}

export type DeliveryState = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface ChatMessage {
  id: string;
  sender: 'local' | 'remote' | 'system';
  text: string;
  ts: number;
  delivery: DeliveryState;
  replyTo?: ReplyRef;
}

export type TransferDirection = 'sending' | 'receiving';
export type TransferState = 'active' | 'complete' | 'cancelled' | 'failed';

export interface FileTransfer {
  id: string;
  name: string;
  size: number;
  mime: string;
  direction: TransferDirection;
  transferred: number;
  state: TransferState;
  error?: string;
  verified?: boolean;
  startedAt: number;
  endedAt?: number;
  url?: string;
}

export interface Diagnostics {
  connectionState: string;
  iceConnectionState: string;
  signalingState: string;
  candidateType: string | null;
  localCandidate: string | null;
  remoteCandidate: string | null;
  rtt: number | null;
  packetsLost: number | null;
  jitter: number | null;
  audioBitrate: number | null;
  videoBitrate: number | null;
  videoResolution: string | null;
  frameRate: number | null;
  updatedAt: number;
}

export interface CallState {
  active: boolean;
  kind: 'none' | 'audio' | 'video';
  micOn: boolean;
  camOn: boolean;
  screenSharing: boolean;
  startedAt: number | null;
  remoteVideo: boolean;
}

export interface MediaDeviceInfoLite {
  deviceId: string;
  label: string;
  kind: 'audioinput' | 'videoinput';
}

export interface Preferences {
  displayName: string;
  keepHistory: boolean;
  encrypt: boolean;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  micDeviceId: string | null;
  camDeviceId: string | null;
  /** Reach the peer through a public STUN server so different networks can meet. */
  usePublicStun: boolean;
  /** Fall back to a shared TURN relay when hole-punching fails. Costs a little latency, gains reachability. */
  useFreeRelay: boolean;
  /** WebSocket endpoints used to carry the handshake behind an invite link. */
  signalingBrokers: string;
  /** Extra ICE servers, one per line: `stun:host:port` or `turn:host:port|user|secret`. */
  customIceServers: string;
  theme: ThemeId;
  accent: AccentId;
  wallpaper: boolean;
}

export type ThemeId = 'midnight' | 'dark' | 'light' | 'whatsapp' | 'letsfi' | 'galib';
/** `auto` keeps whatever accent the theme ships with. */
export type AccentId = 'auto' | 'blue' | 'green' | 'teal' | 'amber' | 'violet' | 'rose';

/** A past session, as shown in the History tab. */
export interface HistoryEntry {
  session: string;
  peer: string;
  updatedAt: number;
  messageCount: number;
  lastMessage: string | null;
}

export type Tab = 'home' | 'history' | 'settings';
