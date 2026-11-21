/**
 * The link handshake.
 *
 * Two devices that share a room code find each other through the broker, agree
 * deterministically which one offers, then exchange SDP and trickle ICE. No
 * camera, no QR code, no copy-paste — a link opened on the other side is enough.
 */
import type { PeerManager } from './PeerManager';
import { SignalBus, DEFAULT_BROKERS, type PresenceInfo, type SignalKind } from './SignalBus';

const PRESENCE_REFRESH_MS = 18_000;
/** A partner whose presence has not been refreshed for this long has closed the page. */
const PRESENCE_STALE_MS = 75_000;
const RETRY_OFFER_AFTER_MS = 12_000;
/**
 * A line that is not open by then is started over. Chromium can leave a
 * handshake in `new` forever when every candidate pair is unreachable —
 * measured at 120 s with no `iceconnectionstate` change at all — so a stalled
 * path has to be timed out, not waited for.
 */
const CONNECT_DEADLINE_MS = 15_000;
/** Handshake attempts after the first one, before the failure is shown. */
const MAX_RESTARTS = 2;

export interface LinkSessionHandlers {
  onStatus?: (message: string) => void;
  onError?: (message: string) => void;
  onPeerName?: (name: string) => void;
  onEnded?: (reason: string) => void;
  onOffering?: () => void;
}

export interface LinkSessionOptions {
  room: string;
  displayName: string;
  makePeer: () => PeerManager;
  handlers?: LinkSessionHandlers;
  brokers?: string[];
}

export class LinkSession {
  readonly room: string;

  private handlers: LinkSessionHandlers;
  private bus: SignalBus;
  private peer: PeerManager | null = null;
  private partner: PresenceInfo | null = null;
  private remoteDescriptionSet = false;
  private queued: RTCIceCandidateInit[] = [];
  private offerSentAt: number | null = null;
  private timers: number[] = [];
  private deadline: number | null = null;
  private closing = false;
  private ended = false;
  private restarts = 0;

  constructor(private options: LinkSessionOptions) {
    this.room = options.room;
    this.handlers = options.handlers ?? {};
    this.bus = new SignalBus(
      options.room,
      options.displayName,
      {
        onStatus: (message) => this.handlers.onStatus?.(message),
        onError: (message) => this.handlers.onError?.(message),
        onReady: () => this.handlers.onStatus?.('Link is live. Send it to the other device.'),
        onPeer: (peer, first) => this.onPresence(peer, first),
        onSignal: (signal) => void this.onSignal(signal.kind, signal.from, signal.data),
        onPeerGone: (id) => {
          if (this.partner?.id === id) this.finish('The other device closed the link.');
        },
        onCrowded: (count) =>
          this.handlers.onError?.(
            `This link already has ${count} devices on it. OpenCall connects two at a time — start a new link.`,
          ),
      },
      options.brokers?.length ? options.brokers : DEFAULT_BROKERS,
    );
  }

  get selfId(): string {
    return this.bus.self.id;
  }

  get peerName(): string {
    return this.partner?.name ?? 'Peer';
  }

  /** True when this device creates the offer, decided from data both sides hold. */
  get isOfferer(): boolean {
    return this.partner ? this.bus.electOfferer(this.partner) : false;
  }

  start(): void {
    this.bus.connect();
    this.timers.push(
      window.setInterval(() => {
        this.bus.refresh();
        this.checkStale();
        this.retryOffer();
      }, PRESENCE_REFRESH_MS / 2),
    );
  }

  /** Called by the orchestrator once the peer connection is live. */
  markConnected(): void {
    this.offerSentAt = null;
    this.clearDeadline();
    this.handlers.onStatus?.('Connected.');
  }

  /**
   * Both descriptions are exchanged, so the only thing left is the path itself.
   * Either side may give up on it; `restart` keeps the role split, so only the
   * device that offers hands out a new handshake.
   */
  private armDeadline(): void {
    this.clearDeadline();
    this.deadline = window.setTimeout(() => {
      this.deadline = null;
      if (this.closing || this.ended || this.peer?.controlOpen) return;
      if (this.restart()) return;
      this.handlers.onError?.(
        'No path was found between the two devices. Retry, or put one of them on mobile data — some networks block the direct path outright.',
      );
    }, CONNECT_DEADLINE_MS);
  }

  private clearDeadline(): void {
    if (this.deadline !== null) window.clearTimeout(this.deadline);
    this.deadline = null;
  }

  /**
   * Tear the agent down and handshake again. A failed first attempt is usually
   * transient address discovery — STUN name resolution was measured to error
   * once before it succeeded on this network — so the link gets a second try
   * before any error reaches the screen. Returns false when the attempts run
   * out, which is when the caller may report the failure.
   */
  restart(): boolean {
    if (this.closing || this.ended || this.restarts >= MAX_RESTARTS) return false;
    this.restarts += 1;
    this.clearDeadline();
    this.peer?.close();
    this.peer = null;
    this.remoteDescriptionSet = false;
    this.queued = [];
    this.offerSentAt = null;
    this.handlers.onStatus?.('Retrying the direct path…');
    if (this.isOfferer) void this.beginOffer();
    return true;
  }

  private onPresence(presence: PresenceInfo, first: boolean): void {
    const known = this.partner;
    if (known && known.id === presence.id) {
      this.partner = presence;
      return;
    }
    if (known) return;
    this.partner = presence;
    this.handlers.onPeerName?.(presence.name);
    if (first) this.handlers.onStatus?.('The other device is here. Opening the line…');
    if (this.isOfferer) void this.beginOffer();
  }

  private ensurePeer(): PeerManager {
    if (!this.peer) {
      this.peer = this.options.makePeer();
      this.peer.setCandidateSink((candidate) => this.forward(candidate));
    }
    return this.peer;
  }

  private forward(candidate: RTCIceCandidateInit): void {
    if (this.partner) this.bus.send('ice', this.partner.id, candidate);
  }

  private async beginOffer(): Promise<void> {
    if (this.closing || !this.partner) return;
    const peer = this.ensurePeer();
    peer.createDataChannels();
    this.handlers.onOffering?.();
    try {
      this.offerSentAt = Date.now();
      const offer = await peer.createOfferTrickle();
      if (!offer.sdp) throw new Error('The browser produced an empty offer.');
      this.bus.send('offer', this.partner.id, offer);
      this.handlers.onStatus?.('Calling the other device…');
    } catch (error) {
      this.handlers.onError?.(error instanceof Error ? error.message : 'Could not start the call.');
    }
  }

  private retryOffer(): void {
    if (this.peer?.pc?.remoteDescription || this.closing || !this.isOfferer) return;
    if (this.offerSentAt === null) {
      if (this.partner) void this.beginOffer();
      return;
    }
    if (Date.now() - this.offerSentAt > RETRY_OFFER_AFTER_MS) void this.beginOffer();
  }

  private async onSignal(kind: SignalKind, from: string, data: unknown): Promise<void> {
    if (this.closing || !this.partner || from !== this.partner.id) return;

    if (kind === 'bye') {
      this.finish('The other device closed the link.');
      return;
    }

    if (kind === 'ice') {
      const candidate = data as RTCIceCandidateInit;
      if (typeof candidate?.candidate !== 'string') return;
      if (this.remoteDescriptionSet && this.peer) {
        await this.peer.addRemoteCandidates([candidate]);
      } else {
        this.queued.push(candidate);
      }
      return;
    }

    if (kind === 'offer') {
      if (this.isOfferer) return;
      const offer = data as RTCSessionDescriptionInit;
      if (offer.type !== 'offer' || !offer.sdp) return;
      const peer = this.ensurePeer();
      peer.listenForDataChannels();
      try {
        await peer.acceptOfferTrickle(offer, this.queued);
        this.queued = [];
        this.remoteDescriptionSet = true;
        const answer = await peer.createAnswerTrickle();
        if (!answer.sdp) throw new Error('The browser produced an empty answer.');
        this.bus.send('answer', from, answer);
        this.armDeadline();
        this.handlers.onStatus?.('Answering the call…');
      } catch (error) {
        this.handlers.onError?.(error instanceof Error ? error.message : 'Could not accept the call.');
      }
      return;
    }

    if (kind === 'answer') {
      if (!this.isOfferer) return;
      const answer = data as RTCSessionDescriptionInit;
      if (answer.type !== 'answer' || !answer.sdp || !this.peer) return;
      try {
        await this.peer.acceptAnswerTrickle(answer, this.queued);
        this.queued = [];
        this.remoteDescriptionSet = true;
        this.offerSentAt = null;
        this.armDeadline();
        this.handlers.onStatus?.('Waiting for the direct path…');
      } catch (error) {
        this.handlers.onError?.(error instanceof Error ? error.message : 'The call could not be completed.');
      }
    }
  }

  private checkStale(): void {
    if (!this.partner || this.peer?.controlOpen) return;
    if (Date.now() - this.partner.ts > PRESENCE_STALE_MS) {
      this.partner = null;
      this.handlers.onStatus?.('Waiting for the other device to open the link…');
    }
  }

  private finish(reason: string): void {
    if (this.ended) return;
    this.ended = true;
    this.handlers.onEnded?.(reason);
  }

  sendBye(): void {
    if (this.partner) this.bus.send('bye', this.partner.id, null);
  }

  close(): void {
    if (this.closing) return;
    this.closing = true;
    this.sendBye();
    this.clearDeadline();
    this.timers.forEach((timer) => window.clearInterval(timer));
    this.timers = [];
    this.peer?.setCandidateSink(null);
    this.bus.close();
    this.peer = null;
    this.partner = null;
    this.queued = [];
  }
}
