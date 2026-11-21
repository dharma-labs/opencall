import type { Diagnostics } from '../../types';
import {
  createPeerConnection,
  describeCandidate,
  primaryCandidateType,
  waitForIceGathering,
  EMPTY_DIAGNOSTICS,
} from './ICEManager';

export const CONTROL_LABEL = 'opencall-control';
export const FILE_LABEL = 'opencall-file';

export interface PeerCallbacks {
  onConnectionState?: (state: RTCPeerConnectionState) => void;
  onIceState?: (state: RTCIceConnectionState) => void;
  onControlOpen?: () => void;
  onControlClose?: () => void;
  onControlMessage?: (data: string) => void;
  onFileMessage?: (data: ArrayBuffer) => void;
  onRemoteStream?: (stream: MediaStream) => void;
  onDiagnostics?: (diagnostics: Diagnostics) => void;
  onError?: (message: string) => void;
}

interface RateSample {
  bytes: number;
  ts: number;
}

/**
 * Owns the RTCPeerConnection, both data channels and the media transceivers.
 *
 * Two `sendrecv` transceivers (audio + video) are created up-front so that a call
 * can be started at any time without triggering a renegotiation — which would
 * otherwise require another manual SDP exchange.
 */
export class PeerManager {
  pc: RTCPeerConnection | null = null;
  control: RTCDataChannel | null = null;
  file: RTCDataChannel | null = null;
  remoteStream: MediaStream = new MediaStream();
  audioSender: RTCRtpSender | null = null;
  videoSender: RTCRtpSender | null = null;

  private statsTimer: number | null = null;
  private rates = new Map<string, RateSample>();
  private closed = false;
  private candidateSink: ((candidate: RTCIceCandidateInit) => void) | null = null;

  constructor(
    private callbacks: PeerCallbacks = {},
    private iceConfig: RTCConfiguration = { iceServers: [] },
  ) {}

  create(): RTCPeerConnection {
    if (this.pc) return this.pc;
    const pc = createPeerConnection(this.iceConfig);
    this.pc = pc;
    this.remoteStream = new MediaStream();

    this.audioSender = pc.addTransceiver('audio', { direction: 'sendrecv' }).sender;
    this.videoSender = pc.addTransceiver('video', { direction: 'sendrecv' }).sender;

    pc.addEventListener('connectionstatechange', () => {
      this.callbacks.onConnectionState?.(pc.connectionState);
    });
    pc.addEventListener('iceconnectionstatechange', () => {
      this.callbacks.onIceState?.(pc.iceConnectionState);
    });
    pc.addEventListener('icecandidate', (event) => {
      if (event.candidate && this.candidateSink) this.candidateSink(event.candidate.toJSON());
    });
    pc.addEventListener('track', (event) => {
      const track = event.track;
      if (!this.remoteStream.getTracks().some((t) => t.id === track.id)) {
        this.remoteStream.addTrack(track);
      }
      track.addEventListener('ended', () => {
        this.remoteStream.removeTrack(track);
        this.callbacks.onRemoteStream?.(this.remoteStream);
      });
      this.callbacks.onRemoteStream?.(this.remoteStream);
    });
    return pc;
  }

  private requirePc(): RTCPeerConnection {
    if (!this.pc) throw new Error('Peer connection has not been created.');
    return this.pc;
  }

  private attachChannel(channel: RTCDataChannel, kind: 'control' | 'file'): void {
    channel.binaryType = 'arraybuffer';
    if (kind === 'file') channel.bufferedAmountLowThreshold = 256 * 1024;
    channel.addEventListener('open', () => {
      if (kind === 'control') this.callbacks.onControlOpen?.();
    });
    channel.addEventListener('close', () => {
      if (kind === 'control') this.callbacks.onControlClose?.();
    });
    channel.addEventListener('error', () => {
      this.callbacks.onError?.(`${kind} channel error`);
    });
    channel.addEventListener('message', (event: MessageEvent) => {
      if (kind === 'control') {
        if (typeof event.data === 'string') this.callbacks.onControlMessage?.(event.data);
      } else if (event.data instanceof ArrayBuffer) {
        this.callbacks.onFileMessage?.(event.data);
      }
    });
  }

  createDataChannels(): void {
    const pc = this.requirePc();
    this.control = pc.createDataChannel(CONTROL_LABEL, { ordered: true });
    this.file = pc.createDataChannel(FILE_LABEL, { ordered: true });
    this.attachChannel(this.control, 'control');
    this.attachChannel(this.file, 'file');
  }

  listenForDataChannels(): void {
    const pc = this.requirePc();
    pc.addEventListener('datachannel', (event) => {
      const channel = event.channel;
      if (channel.label === FILE_LABEL) {
        this.file = channel;
        this.attachChannel(channel, 'file');
      } else {
        this.control = channel;
        this.attachChannel(channel, 'control');
      }
    });
  }

  /* -------------------------------------------------------------- negotiating */

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    const pc = this.requirePc();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGathering(pc);
    if (!pc.localDescription) throw new Error('Local description was not created.');
    return { type: pc.localDescription.type, sdp: pc.localDescription.sdp };
  }

  async acceptOfferAndAnswer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    const pc = this.requirePc();
    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIceGathering(pc);
    if (!pc.localDescription) throw new Error('Local description was not created.');
    return { type: pc.localDescription.type, sdp: pc.localDescription.sdp };
  }

  async acceptAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    const pc = this.requirePc();
    if (pc.signalingState === 'stable') {
      throw new Error('This connection has already been completed.');
    }
    await pc.setRemoteDescription(answer);
  }

  /* -------------------------------------------------------------- trickle

  A link handshake does not wait for ICE to finish gathering: candidates are
  streamed to the other device as they appear, which is what makes a call open
  in about a second instead of after a two-code exchange. */

  setCandidateSink(sink: ((candidate: RTCIceCandidateInit) => void) | null): void {
    this.candidateSink = sink;
  }

  async createOfferTrickle(): Promise<RTCSessionDescriptionInit> {
    const pc = this.requirePc();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    return { type: offer.type, sdp: offer.sdp };
  }

  async acceptOfferTrickle(offer: RTCSessionDescriptionInit, candidates: RTCIceCandidateInit[]): Promise<void> {
    const pc = this.requirePc();
    await pc.setRemoteDescription(offer);
    await this.addRemoteCandidates(candidates);
  }

  async createAnswerTrickle(): Promise<RTCSessionDescriptionInit> {
    const pc = this.requirePc();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    return { type: answer.type, sdp: answer.sdp };
  }

  async acceptAnswerTrickle(answer: RTCSessionDescriptionInit, candidates: RTCIceCandidateInit[]): Promise<void> {
    const pc = this.requirePc();
    await pc.setRemoteDescription(answer);
    await this.addRemoteCandidates(candidates);
  }

  /** Candidates that arrive before the description are queued by the caller, so failures here are not fatal. */
  async addRemoteCandidates(candidates: RTCIceCandidateInit[]): Promise<void> {
    const pc = this.requirePc();
    for (const candidate of candidates) {
      try {
        await pc.addIceCandidate(candidate);
      } catch {
        /* a candidate for a closed or not-yet-described connection */
      }
    }
  }

  /* -------------------------------------------------------------- transport */

  get controlOpen(): boolean {
    return this.control?.readyState === 'open';
  }

  get fileOpen(): boolean {
    return this.file?.readyState === 'open';
  }

  sendControl(payload: string): boolean {
    if (!this.control || this.control.readyState !== 'open') return false;
    try {
      this.control.send(payload);
      return true;
    } catch (error) {
      this.callbacks.onError?.(error instanceof Error ? error.message : 'Failed to send control message');
      return false;
    }
  }

  sendFileBinary(payload: ArrayBuffer): boolean {
    if (!this.file || this.file.readyState !== 'open') return false;
    try {
      this.file.send(payload);
      return true;
    } catch (error) {
      this.callbacks.onError?.(error instanceof Error ? error.message : 'Failed to send file chunk');
      return false;
    }
  }

  get fileBufferedAmount(): number {
    return this.file?.bufferedAmount ?? 0;
  }

  /* -------------------------------------------------------------- stats */

  startDiagnostics(intervalMs = 1500): void {
    if (this.statsTimer !== null) return;
    this.statsTimer = window.setInterval(() => {
      void this.collectDiagnostics();
    }, intervalMs);
    void this.collectDiagnostics();
  }

  stopDiagnostics(): void {
    if (this.statsTimer !== null) {
      window.clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
  }

  private rateFor(id: string, bytes: number | undefined): number | null {
    if (typeof bytes !== 'number') return null;
    const now = Date.now();
    const previous = this.rates.get(id);
    this.rates.set(id, { bytes, ts: now });
    if (!previous || now === previous.ts) return null;
    const deltaBytes = bytes - previous.bytes;
    if (deltaBytes < 0) return null;
    return Math.round((deltaBytes * 8) / ((now - previous.ts) / 1000));
  }

  async collectDiagnostics(): Promise<Diagnostics> {
    const pc = this.pc;
    if (!pc) return EMPTY_DIAGNOSTICS;

    const report = await pc.getStats();
    const byId = new Map<string, Record<string, unknown>>();
    report.forEach((entry) => {
      byId.set(entry.id, entry as unknown as Record<string, unknown>);
    });

    const diagnostics: Diagnostics = {
      ...EMPTY_DIAGNOSTICS,
      connectionState: pc.connectionState,
      iceConnectionState: pc.iceConnectionState,
      signalingState: pc.signalingState,
      updatedAt: Date.now(),
    };

    const selectedPairIds = new Set<string>();
    byId.forEach((entry) => {
      if (entry.type === 'transport' && typeof entry.selectedCandidatePairId === 'string') {
        selectedPairIds.add(entry.selectedCandidatePairId);
      }
      if (entry.type === 'candidate-pair' && (entry.selected === true || entry.state === 'succeeded')) {
        if (entry.nominated === true || entry.selected === true || entry.state === 'succeeded') {
          selectedPairIds.add(String(entry.id));
        }
      }
    });

    for (const pairId of selectedPairIds) {
      const pair = byId.get(pairId);
      if (!pair) continue;
      if (typeof pair.currentRoundTripTime === 'number' && diagnostics.rtt === null) {
        diagnostics.rtt = Math.round(pair.currentRoundTripTime * 1000);
      }
      const local = byId.get(String(pair.localCandidateId));
      const remote = byId.get(String(pair.remoteCandidateId));
      if (local) {
        if (typeof local.candidateType === 'string') diagnostics.candidateType = local.candidateType;
        diagnostics.localCandidate = describeCandidate(local);
      }
      if (remote) diagnostics.remoteCandidate = describeCandidate(remote);
      if (diagnostics.rtt !== null && diagnostics.candidateType) break;
    }

    let totalLost = 0;
    let sawAudioInbound = false;

    byId.forEach((entry) => {
      const kind = entry.kind as string | undefined;
      if (entry.type === 'inbound-rtp') {
        if (typeof entry.packetsLost === 'number') totalLost += entry.packetsLost;
        if (kind === 'audio') {
          sawAudioInbound = true;
          if (typeof entry.jitter === 'number') diagnostics.jitter = Math.round(entry.jitter * 1000);
          if (typeof entry.bytesReceived === 'number') {
            diagnostics.audioBitrate = this.rateFor(`in-audio-${entry.id}`, entry.bytesReceived);
          }
        }
        if (kind === 'video') {
          if (typeof entry.jitter === 'number') diagnostics.jitter = Math.round(entry.jitter * 1000);
          if (typeof entry.bytesReceived === 'number') {
            diagnostics.videoBitrate = this.rateFor(`in-video-${entry.id}`, entry.bytesReceived);
          }
          const width = typeof entry.frameWidth === 'number' ? entry.frameWidth : null;
          const height = typeof entry.frameHeight === 'number' ? entry.frameHeight : null;
          if (width && height) diagnostics.videoResolution = `${width}×${height}`;
          if (typeof entry.framesPerSecond === 'number') diagnostics.frameRate = Math.round(entry.framesPerSecond);
        }
      }
      if (entry.type === 'outbound-rtp') {
        if (typeof entry.bytesSent === 'number') {
          if (kind === 'video') diagnostics.videoBitrate ??= this.rateFor(`out-video-${entry.id}`, entry.bytesSent);
          if (kind === 'audio') diagnostics.audioBitrate ??= this.rateFor(`out-audio-${entry.id}`, entry.bytesSent);
          if (typeof entry.bytesSent === 'number' && kind === 'video' && diagnostics.videoResolution === null) {
            const width = typeof entry.frameWidth === 'number' ? entry.frameWidth : null;
            const height = typeof entry.frameHeight === 'number' ? entry.frameHeight : null;
            if (width && height) diagnostics.videoResolution = `${width}×${height}`;
            if (typeof entry.framesPerSecond === 'number') diagnostics.frameRate = Math.round(entry.framesPerSecond);
          }
        }
      }
    });

    diagnostics.packetsLost = totalLost > 0 || sawAudioInbound ? totalLost : null;

    if (!diagnostics.candidateType) {
      const localSdp = pc.localDescription?.sdp;
      if (localSdp) diagnostics.candidateType = primaryCandidateType(localSdp);
    }

    this.callbacks.onDiagnostics?.(diagnostics);
    return diagnostics;
  }

  /* -------------------------------------------------------------- teardown */

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stopDiagnostics();
    try {
      this.control?.close();
      this.file?.close();
    } catch {
      /* channel already gone */
    }
    try {
      this.pc?.getSenders().forEach((sender) => {
        try {
          void sender.replaceTrack(null);
        } catch {
          /* ignore */
        }
      });
      this.pc?.close();
    } catch {
      /* ignore */
    }
    this.control = null;
    this.file = null;
    this.pc = null;
    this.remoteStream = new MediaStream();
  }
}
