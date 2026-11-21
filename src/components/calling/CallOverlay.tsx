import { useEffect, useMemo, useRef, useState } from 'react';
import { useOpenCall } from '../../contexts/OpenCallContext';
import { formatDuration } from '../../utils';
import { Button, Icon, IconButton, Pill } from '../common/UI';

export function CallOverlay() {
  const {
    call,
    localStream,
    remoteStream,
    remoteAudioBlocked,
    resumeRemoteAudio,
    diagnostics,
    toggleMic,
    toggleCam,
    toggleScreenShare,
    switchCamera,
    endCall,
    peerLabel,
    status,
  } = useOpenCall();

  const remoteRef = useRef<HTMLVideoElement | null>(null);
  const localRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!call.active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [call.active]);

  useEffect(() => {
    if (remoteRef.current && remoteStream && remoteRef.current.srcObject !== remoteStream) {
      remoteRef.current.srcObject = remoteStream;
      void remoteRef.current.play().catch(() => undefined);
    }
  }, [remoteStream, call.active]);

  useEffect(() => {
    if (localRef.current && localStream && localRef.current.srcObject !== localStream) {
      localRef.current.srcObject = localStream;
      void localRef.current.play().catch(() => undefined);
    }
  }, [localStream, call.active]);

  useEffect(() => {
    if (call.active) setMinimized(false);
  }, [call.active]);

  const quality = useMemo(() => {
    if (status === 'failed') return { label: 'No path', tone: 'bad' as const };
    if (!diagnostics) return { label: 'Measuring…', tone: 'neutral' as const };
    const rtt = diagnostics.rtt;
    const loss = diagnostics.packetsLost ?? 0;
    if (rtt === null) return { label: 'Measuring…', tone: 'neutral' as const };
    if (rtt < 150 && loss === 0) return { label: 'Excellent', tone: 'ok' as const };
    if (rtt < 300) return { label: 'Good', tone: 'ok' as const };
    if (rtt < 600) return { label: 'Fair', tone: 'warn' as const };
    return { label: 'Poor', tone: 'bad' as const };
  }, [diagnostics, status]);

  const duration = call.startedAt ? formatDuration(now - call.startedAt) : '00:00';
  const hasLocalVideo = Boolean(localStream?.getVideoTracks().length);

  if (!call.active) return null;

  const enterFullscreen = () => {
    const element = stageRef.current;
    if (!element) return;
    void element.requestFullscreen?.().catch(() => undefined);
  };

  // Collapses to a floating pill so a call can keep running while you read the chat.
  if (minimized) {
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-3 rounded-full border border-ink-700 bg-ink-900/90 px-4 py-2.5 text-left shadow-pop backdrop-blur-xl transition hover:bg-ink-850"
      >
        <span className={`h-2 w-2 rounded-full ${status === 'connected' ? 'bg-ok' : 'bg-warn'}`} />
        <span className="text-xs font-medium text-ink-200">
          {call.kind === 'video' ? 'Video' : 'Voice'} · {duration}
        </span>
        <Icon name="maximize" className="h-3.5 w-3.5 text-ink-400" />
      </button>
    );
  }

  return (
    <div className="animate-fade-in fixed inset-0 z-40 flex flex-col bg-ink-950/95 p-3 backdrop-blur-sm sm:p-5">
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Pill tone={quality.tone} dot>
            {quality.label}
          </Pill>
          <span className="mono tabular-nums text-ink-300">{duration}</span>
          <span className="hidden truncate text-xs text-ink-400 sm:inline">
            {call.kind === 'video' ? 'Video call' : 'Voice call'} with {peerLabel}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <IconButton icon="maximize" label="Full screen" onClick={enterFullscreen} />
          <IconButton icon="chevron-left" label="Minimize call" onClick={() => setMinimized(true)} />
        </div>
      </header>

      <div
        ref={stageRef}
        className="call-stage relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-3xl border border-ink-800"
      >
        {call.kind === 'video' ? (
          <video ref={remoteRef} className="h-full w-full object-contain" autoPlay playsInline muted />
        ) : (
          <div className="relative flex flex-col items-center gap-5">
            <span className="absolute h-28 w-28 rounded-full bg-accent/20 blur-2xl" aria-hidden="true" />
            <span className="relative flex h-24 w-24 items-center justify-center rounded-full border border-ink-700 bg-ink-850 text-3xl font-semibold text-ink-100 shadow-card">
              {peerLabel.slice(0, 1).toUpperCase()}
            </span>
            <p className="text-sm font-medium text-ink-200">{peerLabel}</p>
            <div className="flex items-end gap-1" aria-hidden="true">
              {[0, 1, 2, 3, 4].map((bar) => (
                <span
                  key={bar}
                  className={`w-1 rounded-full bg-accent/70 transition-all ${
                    diagnostics?.audioBitrate ? 'animate-pulse' : ''
                  }`}
                  style={{ height: `${8 + ((diagnostics?.audioBitrate ?? 0) % 20) * 0.6}px` }}
                />
              ))}
            </div>
          </div>
        )}

        {call.kind === 'video' && !call.remoteVideo ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <span className="flex h-16 w-16 items-center justify-center rounded-full border border-ink-700 bg-ink-850">
              <Icon name="video-off" className="h-5 w-5 text-ink-400" />
            </span>
            <p className="text-xs text-ink-400">Waiting for the other camera…</p>
          </div>
        ) : null}

        {hasLocalVideo ? (
          <div className="absolute bottom-3 right-3 w-28 overflow-hidden rounded-2xl border border-ink-700 bg-ink-950 shadow-card sm:w-40">
            <video ref={localRef} className="h-full w-full scale-x-[-1] object-cover" autoPlay playsInline muted />
            <span className="absolute bottom-1.5 left-2 text-[10px] font-medium text-ink-200">
              You{call.screenSharing ? ' · screen' : ''}
            </span>
          </div>
        ) : null}

        {remoteAudioBlocked ? (
          <div className="absolute left-3 top-3">
            <Button size="sm" variant="primary" icon="mic" onClick={resumeRemoteAudio}>
              Tap to hear the other device
            </Button>
          </div>
        ) : null}
      </div>

      <footer className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
        <button
          type="button"
          className={`call-btn ${call.micOn ? '' : 'call-btn-on'}`}
          onClick={() => void toggleMic()}
          aria-label={call.micOn ? 'Mute microphone' : 'Unmute microphone'}
        >
          <Icon name={call.micOn ? 'mic' : 'mic-off'} className="h-5 w-5" />
        </button>
        <button
          type="button"
          className={`call-btn ${call.camOn ? '' : 'call-btn-on'}`}
          onClick={() => void toggleCam()}
          aria-label={call.camOn ? 'Turn camera off' : 'Turn camera on'}
        >
          <Icon name={call.camOn ? 'video' : 'video-off'} className="h-5 w-5" />
        </button>
        <button
          type="button"
          className={`call-btn ${call.screenSharing ? 'call-btn-on' : ''}`}
          onClick={() => void toggleScreenShare()}
          aria-label="Share screen"
        >
          <Icon name="monitor" className="h-5 w-5" />
        </button>
        {call.kind === 'video' ? (
          <button
            type="button"
            className="call-btn"
            onClick={() => void switchCamera()}
            aria-label="Switch camera"
          >
            <Icon name="camera-flip" className="h-5 w-5" />
          </button>
        ) : null}
        <button type="button" className="call-btn call-btn-end" onClick={() => void endCall()} aria-label="End call">
          <Icon name="phone-off" className="h-5 w-5" />
        </button>
      </footer>
      <p className="mt-3 text-center text-[10px] leading-relaxed text-ink-500">
        Encrypted with SRTP by the browser and never recorded. Screen capture stops when you end the call.
      </p>
    </div>
  );
}
