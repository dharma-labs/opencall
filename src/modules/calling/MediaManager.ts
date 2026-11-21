import type { MediaDeviceInfoLite, Preferences } from '../../types';

export interface MediaSender {
  replaceTrack: (track: MediaStreamTrack | null) => Promise<void>;
}

type MediaKind = 'audio' | 'video';

export interface MediaEvents {
  onLocalStream: (stream: MediaStream | null) => void;
  onScreenShareEnded?: () => void;
  onError: (message: string) => void;
}

/**
 * Owns microphone, camera and screen-capture tracks and mirrors them onto the
 * pre-negotiated outbound transceivers, so switching between modes never needs
 * a new SDP exchange.
 */
export class MediaManager {
  private audioSender: MediaSender | null = null;
  private videoSender: MediaSender | null = null;
  private micTrack: MediaStreamTrack | null = null;
  private camTrack: MediaStreamTrack | null = null;
  private screenTrack: MediaStreamTrack | null = null;
  private localStream = new MediaStream();
  private facing: 'user' | 'environment' = 'user';

  constructor(
    private getPreferences: () => Preferences,
    private events: MediaEvents,
  ) {}

  setSenders(audio: MediaSender | null, video: MediaSender | null): void {
    this.audioSender = audio;
    this.videoSender = video;
  }

  get hasMic(): boolean {
    return this.micTrack !== null;
  }

  get hasCamera(): boolean {
    return this.camTrack !== null;
  }

  get isScreenSharing(): boolean {
    return this.screenTrack !== null;
  }

  get stream(): MediaStream | null {
    return this.localStream.getTracks().length ? this.localStream : null;
  }

  private audioConstraints(): MediaTrackConstraints {
    const prefs = this.getPreferences();
    return {
      deviceId: prefs.micDeviceId ? { exact: prefs.micDeviceId } : undefined,
      echoCancellation: prefs.echoCancellation,
      noiseSuppression: prefs.noiseSuppression,
      autoGainControl: prefs.autoGainControl,
    };
  }

  private videoConstraints(): MediaTrackConstraints {
    const prefs = this.getPreferences();
    return {
      deviceId: prefs.camDeviceId ? { exact: prefs.camDeviceId } : undefined,
      facingMode: prefs.camDeviceId ? undefined : this.facing,
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, max: 30 },
    };
  }

  private async captureAudio(): Promise<MediaStreamTrack> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: this.audioConstraints(), video: false });
    return stream.getAudioTracks()[0];
  }

  private async captureVideo(): Promise<MediaStreamTrack> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: this.videoConstraints() });
    return stream.getVideoTracks()[0];
  }

  static describeError(error: unknown, kind: MediaKind): string {
    const name = (error as { name?: string } | null)?.name ?? '';
    if (name === 'NotAllowedError') {
      return kind === 'audio' ? 'Microphone permission was denied.' : 'Camera permission was denied.';
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      return kind === 'audio' ? 'No usable microphone was found.' : 'No usable camera was found.';
    }
    if (name === 'NotReadableError') {
      return kind === 'audio' ? 'The microphone is already in use by another application.' : 'The camera is already in use by another application.';
    }
    if (error instanceof Error) return error.message;
    return 'Media capture failed.';
  }

  private syncLocalStream(): void {
    const next = new MediaStream();
    if (this.micTrack) next.addTrack(this.micTrack);
    const activeVideo = this.screenTrack ?? this.camTrack;
    if (activeVideo) next.addTrack(activeVideo);
    this.localStream = next;
    this.events.onLocalStream(next.getTracks().length ? next : null);
  }

  async startAudio(): Promise<boolean> {
    if (this.micTrack) {
      this.micTrack.enabled = true;
      return true;
    }
    this.micTrack = await this.captureAudio();
    this.micTrack.enabled = true;
    this.syncLocalStream();
    await this.audioSender?.replaceTrack(this.micTrack);
    return true;
  }

  async startVideo(): Promise<boolean> {
    if (!this.micTrack) {
      try {
        await this.startAudio();
      } catch {
        /* video-only call remains possible */
      }
    }
    if (!this.camTrack) {
      this.camTrack = await this.captureVideo();
      this.camTrack.enabled = true;
      this.syncLocalStream();
      await this.videoSender?.replaceTrack(this.camTrack);
    }
    return true;
  }

  async setMicEnabled(enabled: boolean): Promise<void> {
    if (this.micTrack) this.micTrack.enabled = enabled;
  }

  async setCamEnabled(enabled: boolean): Promise<void> {
    if (this.camTrack) this.camTrack.enabled = enabled;
  }

  get micEnabled(): boolean {
    return this.micTrack?.enabled ?? false;
  }

  get camEnabled(): boolean {
    return this.camTrack?.enabled ?? false;
  }

  /** Switches between front and rear camera where the device exposes both. */
  async switchCamera(): Promise<void> {
    if (!this.camTrack) return;
    const next: 'user' | 'environment' = this.facing === 'user' ? 'environment' : 'user';
    const previousFacing = this.facing;
    this.facing = next;
    try {
      const track = await this.captureVideo();
      const old = this.camTrack;
      this.camTrack = track;
      if (!this.screenTrack) await this.videoSender?.replaceTrack(track);
      old.stop();
      this.syncLocalStream();
    } catch (error) {
      this.facing = previousFacing;
      this.events.onError(MediaManager.describeError(error, 'video'));
    }
  }

  async startScreenShare(): Promise<boolean> {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error('Screen sharing is not supported by this browser.');
    }
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error('No screen capture track was provided.');
    this.screenTrack = track;
    track.addEventListener('ended', () => {
      void this.stopScreenShare();
      this.events.onScreenShareEnded?.();
    });
    await this.videoSender?.replaceTrack(track);
    this.syncLocalStream();
    return true;
  }

  async stopScreenShare(): Promise<void> {
    if (!this.screenTrack) return;
    this.screenTrack.stop();
    this.screenTrack = null;
    await this.videoSender?.replaceTrack(this.camTrack ?? null);
    this.syncLocalStream();
  }

  async stopAll(): Promise<void> {
    this.screenTrack?.stop();
    this.camTrack?.stop();
    this.micTrack?.stop();
    this.screenTrack = null;
    this.camTrack = null;
    this.micTrack = null;
    await this.audioSender?.replaceTrack(null);
    await this.videoSender?.replaceTrack(null);
    this.localStream = new MediaStream();
    this.events.onLocalStream(null);
  }

  async listDevices(): Promise<MediaDeviceInfoLite[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === 'audioinput' || device.kind === 'videoinput')
      .map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `${device.kind === 'audioinput' ? 'Microphone' : 'Camera'} ${index + 1}`,
        kind: device.kind as 'audioinput' | 'videoinput',
      }));
  }
}
