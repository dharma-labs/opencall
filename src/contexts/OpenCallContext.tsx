import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  CallState,
  ChatMessage,
  ConnectionStatus,
  Diagnostics,
  FileTransfer,
  MediaDeviceInfoLite,
  Phase,
  Preferences,
  ReplyRef,
  Role,
} from '../types';
import { uid } from '../utils';
import { PeerManager, type PeerCallbacks } from '../modules/connection/PeerManager';
import { buildIceConfig, warmIceServers } from '../modules/connection/ICEManager';
import { LinkSession } from '../modules/connection/LinkSession';
import {
  buildRoomLink,
  clearRoomFromLocation,
  createRoomCode,
  DEFAULT_BROKERS,
  readRoomFromLocation,
} from '../modules/connection/SignalBus';
import { applyTheme } from '../modules/platform/ThemeManager';
import {
  createSignal,
  decodeSignal,
  encodeSignal,
  joinQrParts,
  parseChunkPart,
  looksLikeSignal,
  readShareLink,
  splitForQr,
} from '../modules/connection/SignalingManager';
import { EncryptionManager } from '../modules/security/EncryptionManager';
import { FileTransferManager } from '../modules/files/FileTransferManager';
import { MediaManager } from '../modules/calling/MediaManager';
import {
  buildEncryptedEnvelope,
  buildPlainEnvelope,
  byeMessage,
  chatMessage,
  helloMessage,
  isInnerMessage,
  parseEnvelope,
  readMessage,
  sanitiseText,
  typingMessage,
  ackMessage,
  TYPING_TTL_MS,
  type Envelope,
  type InnerMessage,
} from '../modules/messaging/MessageProtocol';
import {
  clearConversation as clearStoredConversation,
  loadPreferences,
  saveConversation,
  savePreferences,
} from '../modules/storage/StorageManager';

export interface LogEntry {
  id: string;
  level: 'info' | 'warn' | 'error';
  text: string;
  ts: number;
}

export interface OpenCallApi {
  phase: Phase;
  role: Role | null;
  status: ConnectionStatus;
  error: string | null;
  clearError: () => void;
  localPayload: string;
  qrParts: string[];
  qrIndex: number;
  setQrIndex: (index: number) => void;
  scannedParts: number;
  scanTotal: number;
  messages: ChatMessage[];
  typing: boolean;
  transfers: FileTransfer[];
  diagnostics: Diagnostics | null;
  call: CallState;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  remoteAudioBlocked: boolean;
  resumeRemoteAudio: () => void;
  safetyCode: string | null;
  encryptionReady: boolean;
  peerLabel: string;
  preferences: Preferences;
  devices: MediaDeviceInfoLite[];
  log: LogEntry[];
  canCall: boolean;

  /** Link pairing: the room code, the shareable URL and the latest relay status. */
  linkRoom: string;
  linkUrl: string;
  linkStatus: string;

  updatePreferences: (patch: Partial<Preferences>) => void;
  startLink: (room?: string) => Promise<void>;
  cancelLink: () => void;
  startHost: () => Promise<void>;
  startGuest: () => void;
  cancelSetup: () => void;
  submitGuestData: (text: string) => Promise<void>;
  addScannedPart: (text: string) => Promise<void>;
  resetScan: () => void;
  completeAsHost: (text: string) => Promise<void>;
  sendMessage: (text: string, replyTo?: ReplyRef) => Promise<void>;
  sendTyping: (on: boolean) => void;
  markConversationRead: () => void;
  deleteMessage: (id: string) => void;
  clearConversation: () => void;
  sendFiles: (files: FileList | File[]) => Promise<void>;
  cancelTransfer: (id: string) => void;
  startVoiceCall: () => Promise<void>;
  startVideoCall: () => Promise<void>;
  endCall: () => Promise<void>;
  toggleMic: () => Promise<void>;
  toggleCam: () => Promise<void>;
  toggleScreenShare: () => Promise<void>;
  switchCamera: () => Promise<void>;
  refreshDevices: () => Promise<void>;
  disconnect: () => void;
}

const EMPTY_CALL: CallState = {
  active: false,
  kind: 'none',
  micOn: false,
  camOn: false,
  screenSharing: false,
  startedAt: null,
  remoteVideo: false,
};

const OpenCallContext = createContext<OpenCallApi | null>(null);

export function useOpenCall(): OpenCallApi {
  const value = useContext(OpenCallContext);
  if (!value) throw new Error('useOpenCall must be used inside an OpenCallProvider.');
  return value;
}

export function OpenCallProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('landing');
  const [role, setRole] = useState<Role | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [localPayload, setLocalPayload] = useState('');
  const [qrParts, setQrParts] = useState<string[]>([]);
  const [qrIndex, setQrIndex] = useState(0);
  const [rawScanned, setRawScanned] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [typing, setTyping] = useState(false);
  const [transfers, setTransfers] = useState<FileTransfer[]>([]);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [call, setCall] = useState<CallState>(EMPTY_CALL);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [remoteAudioBlocked, setRemoteAudioBlocked] = useState(false);
  const [safetyCode, setSafetyCode] = useState<string | null>(null);
  const [encryptionReady, setEncryptionReady] = useState(false);
  const [peerLabel, setPeerLabel] = useState('Peer');
  const [preferences, setPreferences] = useState<Preferences>(() => loadPreferences());
  const [devices, setDevices] = useState<MediaDeviceInfoLite[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [linkRoom, setLinkRoom] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkStatus, setLinkStatus] = useState('');

  const peerRef = useRef<PeerManager | null>(null);
  const linkRef = useRef<LinkSession | null>(null);
  const cryptoRef = useRef<EncryptionManager | null>(null);
  const fileRef = useRef<FileTransferManager | null>(null);
  const mediaRef = useRef<MediaManager | null>(null);
  const sessionRef = useRef<string>('');
  const seenRef = useRef<Set<string>>(new Set());
  const messagesRef = useRef<ChatMessage[]>([]);
  const prefsRef = useRef<Preferences>(preferences);
  const sendInnerRef = useRef<(inner: InnerMessage) => Promise<void>>(async () => undefined);
  const ackTimersRef = useRef<Map<string, number>>(new Map());
  const typingOutRef = useRef<number>(0);
  const typingInTimerRef = useRef<number | null>(null);
  const helloRef = useRef(false);
  const keySentRef = useRef(false);
  const focusedRef = useRef(true);
  const scannedRef = useRef<string[]>([]);
  const phaseRef = useRef<Phase>('landing');
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    prefsRef.current = preferences;
  }, [preferences]);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    scannedRef.current = rawScanned;
  }, [rawScanned]);

  const pushLog = useCallback((level: LogEntry['level'], text: string) => {
    setLog((prev) => [...prev.slice(-60), { id: uid(), level, text, ts: Date.now() }]);
  }, []);

  const applyTransfers = useCallback((updater: (prev: FileTransfer[]) => FileTransfer[]) => {
    setTransfers(updater);
  }, []);

  /* ------------------------------------------------------------ media sink */

  useEffect(() => {
    const element = audioElementRef.current;
    if (!element || !remoteStream) return;
    element.srcObject = remoteStream;
    const attempt = () => {
      element
        .play()
        .then(() => setRemoteAudioBlocked(false))
        .catch(() => setRemoteAudioBlocked(true));
    };
    attempt();
  }, [remoteStream]);

  const resumeRemoteAudio = useCallback(() => {
    const element = audioElementRef.current;
    if (!element) return;
    element
      .play()
      .then(() => setRemoteAudioBlocked(false))
      .catch(() => setRemoteAudioBlocked(true));
  }, []);

  /* ------------------------------------------------------------ transport */

  const sendInner = useCallback(async (inner: InnerMessage): Promise<void> => {
    const peer = peerRef.current;
    if (!peer) throw new Error('No active connection.');
    const crypto = cryptoRef.current;
    let envelope: Envelope;
    if (prefsRef.current.encrypt && crypto?.ready) {
      const { iv, ct } = await crypto.encrypt(JSON.stringify(inner));
      envelope = buildEncryptedEnvelope(iv, ct);
    } else {
      envelope = buildPlainEnvelope(inner);
    }
    if (!peer.sendControl(JSON.stringify(envelope))) {
      throw new Error('The data channel is not open yet.');
    }
  }, []);

  useEffect(() => {
    sendInnerRef.current = sendInner;
  }, [sendInner]);

  const exchangeKeys = useCallback(async () => {
    const crypto = cryptoRef.current;
    if (!crypto || keySentRef.current) return;
    keySentRef.current = true;
    try {
      await sendInnerRef.current({ t: 'key', pub: crypto.publicKey, ts: Date.now() });
    } catch {
      keySentRef.current = false;
    }
  }, []);

  const sendHello = useCallback(async () => {
    if (helloRef.current) return;
    helloRef.current = true;
    try {
      await sendInnerRef.current(helloMessage(prefsRef.current.displayName || 'Peer'));
    } catch {
      helloRef.current = false;
    }
  }, []);

  const setDelivery = useCallback((ids: string[], state: ChatMessage['delivery']) => {
    if (!ids.length) return;
    const wanted = new Set(ids);
    setMessages((prev) =>
      prev.map((message) => (wanted.has(message.id) && message.sender === 'local' ? { ...message, delivery: state } : message)),
    );
    for (const id of ids) {
      const timer = ackTimersRef.current.get(id);
      if (timer) {
        window.clearTimeout(timer);
        ackTimersRef.current.delete(id);
      }
    }
  }, []);

  const handleInner = useCallback(
    (inner: InnerMessage) => {
      switch (inner.t) {
        case 'hello': {
          if (typeof inner.name === 'string' && inner.name.trim()) setPeerLabel(inner.name.trim().slice(0, 32));
          break;
        }
        case 'key': {
          const crypto = cryptoRef.current;
          if (!crypto || typeof inner.pub !== 'string') break;
          if (crypto.peerPublicKey === inner.pub) break;
          crypto
            .deriveSharedKey(inner.pub)
            .then((code) => {
              setEncryptionReady(true);
              setSafetyCode(code);
              pushLog('info', 'Channel key established. Compare the safety code with the other device.');
            })
            .catch(() => pushLog('warn', 'Key exchange failed; continuing without extra encryption.'));
          break;
        }
        case 'msg': {
          const id = typeof inner.id === 'string' ? inner.id : uid();
          if (seenRef.current.has(id)) break;
          seenRef.current.add(id);
          const text = sanitiseText(String(inner.text ?? ''));
          if (!text) break;
          const message: ChatMessage = {
            id,
            sender: 'remote',
            text,
            ts: typeof inner.ts === 'number' ? inner.ts : Date.now(),
            delivery: 'delivered',
            ...(inner.replyTo ? { replyTo: inner.replyTo } : {}),
          };
          setMessages((prev) => [...prev, message]);
          void sendInnerRef.current(ackMessage([id])).catch(() => undefined);
          if (focusedRef.current) {
            setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, delivery: 'read' } : m)));
            void sendInnerRef.current(readMessage([id])).catch(() => undefined);
          }
          break;
        }
        case 'ack': {
          setDelivery(Array.isArray(inner.ids) ? inner.ids : [], 'delivered');
          break;
        }
        case 'read': {
          setDelivery(Array.isArray(inner.ids) ? inner.ids : [], 'read');
          break;
        }
        case 'typing': {
          setTyping(Boolean(inner.on));
          if (typingInTimerRef.current !== null) window.clearTimeout(typingInTimerRef.current);
          typingInTimerRef.current = window.setTimeout(() => setTyping(false), TYPING_TTL_MS);
          break;
        }
        case 'file-meta':
        case 'file-done':
        case 'file-cancel': {
          fileRef.current?.handleControl(inner);
          break;
        }
        case 'bye': {
          pushLog('warn', 'The other device closed the session.');
          setStatus('disconnected');
          break;
        }
      }
    },
    [pushLog, setDelivery],
  );

  const handleControlFrame = useCallback(
    async (raw: string) => {
      const envelope = parseEnvelope(raw);
      if (!envelope) {
        pushLog('warn', 'Ignored a malformed control frame.');
        return;
      }
      let inner: InnerMessage | null = null;
      if (envelope.enc) {
        const crypto = cryptoRef.current;
        if (!crypto?.ready) {
          pushLog('warn', 'Received encrypted content before the key exchange finished.');
          return;
        }
        try {
          const text = await crypto.decrypt(envelope.enc.iv, envelope.enc.ct);
          const parsed: unknown = JSON.parse(text);
          if (!isInnerMessage(parsed)) return;
          inner = parsed;
        } catch {
          pushLog('warn', 'Could not decrypt an inbound frame.');
          return;
        }
      } else if (envelope.p) {
        inner = envelope.p;
      }
      if (inner) handleInner(inner);
    },
    [handleInner, pushLog],
  );

  /* ------------------------------------------------------------ peer wiring */

  const createPeer = useCallback((): PeerManager => {
    const callbacks: PeerCallbacks = {
      onConnectionState: (state) => {
        if (state === 'connected') {
          setStatus('connected');
          setPhase('session');
          setLinkStatus('');
          linkRef.current?.markConnected();
          pushLog('info', 'Peer connection established.');
          peer.startDiagnostics();
          void exchangeKeys();
          void sendHello();
        } else if (state === 'connecting') {
          setStatus('connecting');
        } else if (state === 'disconnected') {
          setStatus('degraded');
          pushLog('warn', 'Connection interrupted. Waiting for ICE to recover.');
        } else if (state === 'failed') {
          if (linkRef.current?.restart()) return;
          setStatus('failed');
          setError(
            'No path was found between the two devices. Retry, or put one of them on mobile data — some networks block the direct path outright.',
          );
          pushLog('error', 'Peer connection failed. STUN found no usable path.');
        } else if (state === 'closed') {
          setStatus('disconnected');
        }
      },
      onIceState: (state) => {
        if (state === 'checking') setStatus((prev) => (prev === 'connected' ? prev : 'connecting'));
        if (state === 'failed') {
          if (linkRef.current?.restart()) return;
          setStatus('failed');
          setError(
            'Address discovery failed. Check that both devices have internet access and that the network does not block UDP.',
          );
        }
      },
      onControlOpen: () => {
        pushLog('info', 'Data channel open.');
        void exchangeKeys();
        void sendHello();
      },
      onControlClose: () => {
        pushLog('warn', 'Data channel closed.');
        setStatus((prev) => (prev === 'failed' ? prev : 'disconnected'));
      },
      onControlMessage: (data) => {
        void handleControlFrame(data);
      },
      onFileMessage: (data) => {
        fileRef.current?.handleBinary(data);
      },
      onRemoteStream: (stream) => {
        setRemoteStream(stream);
        setCall((prev) => ({ ...prev, remoteVideo: stream.getVideoTracks().some((track) => track.readyState === 'live') }));
      },
      onDiagnostics: (next) => setDiagnostics(next),
      onError: (message) => pushLog('error', message),
    };

    const peer = new PeerManager(callbacks, buildIceConfig(prefsRef.current));
    peer.create();
    mediaRef.current?.setSenders(peer.audioSender, peer.videoSender);

    fileRef.current?.reset();
    fileRef.current = new FileTransferManager(
      {
        sendControl: (inner) => sendInnerRef.current(inner),
        sendBinary: (frame) => peerRef.current?.sendFileBinary(frame) ?? false,
        bufferedAmount: () => peerRef.current?.fileBufferedAmount ?? 0,
      },
      {
        onCreate: (transfer) => applyTransfers((prev) => [...prev, transfer]),
        onUpdate: (id, patch) =>
          applyTransfers((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item))),
      },
    );

    peerRef.current = peer;
    return peer;
  }, [applyTransfers, exchangeKeys, handleControlFrame, pushLog, sendHello]);

  const ensureMedia = useCallback((): MediaManager => {
    if (!mediaRef.current) {
      mediaRef.current = new MediaManager(
        () => prefsRef.current,
        {
          onLocalStream: (stream) => setLocalStream(stream),
          onScreenShareEnded: () => setCall((prev) => ({ ...prev, screenSharing: false })),
          onError: (message) => {
            setError(message);
            pushLog('error', message);
          },
        },
      );
      mediaRef.current.setSenders(peerRef.current?.audioSender ?? null, peerRef.current?.videoSender ?? null);
    }
    return mediaRef.current;
  }, [pushLog]);

  /* ------------------------------------------------------------ lifecycle */

  const brokerList = useCallback((): string[] => {
    const configured = prefsRef.current.signalingBrokers
      .split(/[\s,]+/)
      .map((line) => line.trim())
      .filter(Boolean);
    return configured.length ? configured : DEFAULT_BROKERS;
  }, []);

  const closeLink = useCallback(() => {
    linkRef.current?.close();
    linkRef.current = null;
    setLinkRoom('');
    setLinkUrl('');
    setLinkStatus('');
  }, []);

  const teardown = useCallback(() => {
    linkRef.current?.close();
    linkRef.current = null;
    try {
      peerRef.current?.sendControl(JSON.stringify(buildPlainEnvelope(byeMessage())));
    } catch {
      /* ignore */
    }
    peerRef.current?.close();
    peerRef.current = null;
    fileRef.current?.reset();
    fileRef.current = null;
    void mediaRef.current?.stopAll();
    cryptoRef.current?.reset();
    cryptoRef.current = null;
    ackTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    ackTimersRef.current.clear();
    if (typingInTimerRef.current !== null) window.clearTimeout(typingInTimerRef.current);
    setLocalStream(null);
    setRemoteStream(null);
    setDiagnostics(null);
    setEncryptionReady(false);
    setSafetyCode(null);
    setTyping(false);
    setCall(EMPTY_CALL);
  }, []);

  const disconnect = useCallback(() => {
    teardown();
    closeLink();
    setPhase('landing');
    setRole(null);
    setStatus('idle');
    setLocalPayload('');
    setQrParts([]);
    setQrIndex(0);
    setRawScanned([]);
    setPeerLabel('Peer');
    helloRef.current = false;
    keySentRef.current = false;
    seenRef.current.clear();
    pushLog('info', 'Session closed and media stopped.');
  }, [closeLink, pushLog, teardown]);

  useEffect(() => {
    return () => {
      linkRef.current?.close();
      peerRef.current?.close();
      void mediaRef.current?.stopAll();
    };
  }, []);

  const prepareCrypto = useCallback(async () => {
    try {
      cryptoRef.current = await EncryptionManager.create();
      keySentRef.current = false;
      setEncryptionReady(false);
      setSafetyCode(null);
    } catch {
      cryptoRef.current = null;
      pushLog('warn', 'WebCrypto is unavailable; the session will use WebRTC DTLS only.');
    }
  }, [pushLog]);

  const resetForNewSession = useCallback(() => {
    setError(null);
    setMessages([]);
    setTransfers([]);
    setRawScanned([]);
    setQrIndex(0);
    setLocalPayload('');
    setQrParts([]);
    setPeerLabel('Peer');
    helloRef.current = false;
    keySentRef.current = false;
    seenRef.current.clear();
  }, []);

  /* ------------------------------------------------------------ link pairing */

  /**
   * Opens a room and publishes the invite link. Which side sends the offer is
   * decided from the presence frames both devices can see, so the code works
   * whichever order the two links are opened in.
   */
  const startLink = useCallback(
    async (room?: string) => {
      teardown();
      closeLink();
      resetForNewSession();
      setError(null);
      const code = (room ?? createRoomCode()).toLowerCase();
      sessionRef.current = code;
      setRole('host');
      setPhase('link');
      setStatus('preparing');
      setLinkRoom(code);
      setLinkUrl(buildRoomLink(code, prefsRef.current.displayName) ?? '');
      setLinkStatus('Opening the link…');
      await prepareCrypto();
      const session = new LinkSession({
        room: code,
        displayName: prefsRef.current.displayName || 'Peer',
        brokers: brokerList(),
        makePeer: () => createPeer(),
        warmIce: () => warmIceServers(buildIceConfig(prefsRef.current)),
        handlers: {
          onStatus: (message) => setLinkStatus(message),
          onPeerName: (name) => setPeerLabel(name),
          onOffering: () => setStatus('connecting'),
          onError: (message) => {
            setError(message);
            setStatus('failed');
            pushLog('error', message);
          },
          onEnded: (reason) => {
            pushLog('warn', reason);
            teardown();
            closeLink();
            setPhase('landing');
            setRole(null);
            setStatus('idle');
            setError(reason);
          },
        },
      });
      linkRef.current = session;
      session.start();
      pushLog('info', 'Invite link ready. The other device only has to open it.');
    },
    [brokerList, closeLink, createPeer, prepareCrypto, pushLog, resetForNewSession, teardown],
  );

  const cancelLink = useCallback(() => {
    linkRef.current?.sendBye();
    closeLink();
    teardown();
    setPhase('landing');
    setRole(null);
    setStatus('idle');
    setError(null);
  }, [closeLink, teardown]);

  // An invite link opened anywhere lands the user straight in the handshake.
  const autoLinkRef = useRef(false);
  useEffect(() => {
    if (autoLinkRef.current) return;
    const found = readRoomFromLocation();
    if (!found) return;
    autoLinkRef.current = true;
    if (found.name) setPeerLabel(found.name);
    clearRoomFromLocation();
    void startLink(found.room);
  }, [startLink]);

  useEffect(() => {
    applyTheme(preferences.theme, preferences.accent, preferences.wallpaper);
  }, [preferences.theme, preferences.accent, preferences.wallpaper]);

  const startHost = useCallback(async () => {
    teardown();
    closeLink();
    resetForNewSession();
    setRole('host');
    setPhase('host-prepare');
    setStatus('preparing');
    sessionRef.current = uid();
    try {
      await prepareCrypto();
      const peer = createPeer();
      peer.createDataChannels();
      const offer = await peer.createOffer();
      if (!offer.sdp) throw new Error('The browser produced an empty SDP offer.');
      const payload = await encodeSignal(
        createSignal('offer', sessionRef.current, { type: 'offer', sdp: offer.sdp }),
      );
      setLocalPayload(payload);
      setQrParts(splitForQr(payload));
      setPhase('host-wait-answer');
      setStatus('awaiting-peer');
      pushLog('info', 'Invite ready. Show the QR code, or copy the connection data to the other device.');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not create the invite.';
      setError(message);
      setStatus('failed');
      pushLog('error', message);
    }
  }, [closeLink, createPeer, prepareCrypto, pushLog, resetForNewSession, teardown]);

  const startGuest = useCallback(() => {
    teardown();
    closeLink();
    resetForNewSession();
    setRole('guest');
    setPhase('guest-enter');
    setStatus('idle');
  }, [closeLink, resetForNewSession, teardown]);

  const cancelSetup = useCallback(() => {
    teardown();
    closeLink();
    setPhase('landing');
    setRole(null);
    setStatus('idle');
    setLocalPayload('');
    setQrParts([]);
    setRawScanned([]);
    setError(null);
  }, [closeLink, teardown]);

  const submitGuestData = useCallback(
    async (text: string) => {
      setError(null);
      try {
        const payload = joinQrParts([readShareLink(text) ?? text]);
        const signal = await decodeSignal(payload);
        if (signal.kind !== 'offer') {
          throw new Error('That connection data is an answer. Use "Create connection" on this device instead.');
        }
        setStatus('preparing');
        await prepareCrypto();
        const peer = createPeer();
        peer.listenForDataChannels();
        const answer = await peer.acceptOfferAndAnswer({ type: 'offer', sdp: signal.sdp.sdp });
        if (!answer.sdp) throw new Error('The browser produced an empty SDP answer.');
        sessionRef.current = signal.session;
        const outbound = await encodeSignal(
          createSignal('answer', signal.session, { type: 'answer', sdp: answer.sdp }),
        );
        setLocalPayload(outbound);
        setQrParts(splitForQr(outbound));
        setPhase('guest-show-answer');
        setStatus('awaiting-peer');
        pushLog('info', 'Response ready. Send it back to the device that created the invite.');
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'Could not join this connection.';
        setError(message);
        pushLog('error', message);
      }
    },
    [createPeer, prepareCrypto, pushLog],
  );

  const addScannedPart = useCallback(
    async (text: string) => {
      const value = text.trim();
      if (!value) return;
      if (looksLikeSignal(value) && !parseChunkPart(value)) {
        setRawScanned([]);
        await submitGuestData(value);
        return;
      }
      const chunk = parseChunkPart(value);
      if (!chunk) {
        setError('That QR code does not contain OpenCall connection data.');
        return;
      }
      const current = scannedRef.current;
      if (current.includes(value)) return;
      const next = [...current, value];
      setRawScanned(next);
      if (next.length >= chunk.total) {
        setRawScanned([]);
        await submitGuestData(joinQrParts(next));
      }
    },
    [submitGuestData],
  );

  const resetScan = useCallback(() => setRawScanned([]), []);

  const completeAsHost = useCallback(
    async (text: string) => {
      setError(null);
      try {
        const payload = joinQrParts([readShareLink(text) ?? text]);
        const signal = await decodeSignal(payload);
        if (signal.kind !== 'answer') {
          throw new Error('That connection data is an invite. It must be scanned by the joining device.');
        }
        const peer = peerRef.current;
        if (!peer) throw new Error('The invite is no longer active.');
        if (signal.session !== sessionRef.current) {
          throw new Error('That response belongs to a different invite.');
        }
        await peer.acceptAnswer({ type: 'answer', sdp: signal.sdp.sdp });
        setStatus('connecting');
        setPhase('session');
        pushLog('info', 'Response accepted. Waiting for the peer connection to go live.');
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'Could not accept this response.';
        setError(message);
        pushLog('error', message);
      }
    },
    [pushLog],
  );

  /* ------------------------------------------------------------ chat */

  const sendMessage = useCallback(
    async (text: string, replyTo?: ReplyRef) => {
      const clean = sanitiseText(text);
      if (!clean) return;
      const inner = chatMessage(clean, replyTo);
      if (inner.t !== 'msg') return;
      const message: ChatMessage = {
        id: inner.id,
        sender: 'local',
        text: clean,
        ts: inner.ts,
        delivery: 'pending',
        ...(replyTo ? { replyTo } : {}),
      };
      setMessages((prev) => [...prev, message]);
      try {
        await sendInnerRef.current(inner);
        setMessages((prev) => prev.map((item) => (item.id === inner.id ? { ...item, delivery: 'sent' } : item)));
        const timer = window.setTimeout(() => {
          ackTimersRef.current.delete(inner.id);
          setMessages((prev) =>
            prev.map((item) => (item.id === inner.id && item.delivery === 'sent' ? { ...item, delivery: 'failed' } : item)),
          );
        }, 12000);
        ackTimersRef.current.set(inner.id, timer);
      } catch (cause) {
        setMessages((prev) => prev.map((item) => (item.id === inner.id ? { ...item, delivery: 'failed' } : item)));
        pushLog('error', cause instanceof Error ? cause.message : 'Message could not be sent.');
      }
    },
    [pushLog],
  );

  const sendTyping = useCallback((on: boolean) => {
    const now = Date.now();
    if (on && now - typingOutRef.current < 1500) return;
    typingOutRef.current = now;
    void sendInnerRef.current(typingMessage(on)).catch(() => undefined);
  }, []);

  const markConversationRead = useCallback(() => {
    const unread = messagesRef.current.filter((m) => m.sender === 'remote' && m.delivery !== 'read').map((m) => m.id);
    if (!unread.length) return;
    setMessages((prev) => prev.map((m) => (m.sender === 'remote' ? { ...m, delivery: 'read' } : m)));
    void sendInnerRef.current(readMessage(unread)).catch(() => undefined);
  }, []);

  const deleteMessage = useCallback((id: string) => {
    setMessages((prev) => prev.filter((message) => message.id !== id));
  }, []);

  const clearConversation = useCallback(() => {
    setMessages([]);
    seenRef.current.clear();
    if (sessionRef.current) void clearStoredConversation(sessionRef.current);
    pushLog('info', 'Local conversation cleared.');
  }, [pushLog]);

  /* ------------------------------------------------------------ files */

  const sendFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (!list.length) return;
      const manager = fileRef.current;
      if (!manager) {
        setError('Connect to a peer before sending files.');
        return;
      }
      for (const file of list) {
        try {
          await manager.sendFile(file);
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : 'File could not be sent.';
          setError(message);
          pushLog('error', message);
        }
      }
    },
    [pushLog],
  );

  const cancelTransfer = useCallback((id: string) => {
    fileRef.current?.cancel(id);
  }, []);

  /* ------------------------------------------------------------ calling */

  const startVoiceCall = useCallback(async () => {
    if (!peerRef.current?.controlOpen) {
      setError('Connect to a peer before starting a call.');
      return;
    }
    const media = ensureMedia();
    try {
      await media.startAudio();
      setCall((prev) => ({
        ...prev,
        active: true,
        kind: prev.kind === 'video' ? 'video' : 'audio',
        micOn: true,
        startedAt: prev.startedAt ?? Date.now(),
      }));
      pushLog('info', 'Voice call started.');
    } catch (cause) {
      const message = MediaManager.describeError(cause, 'audio');
      setError(message);
      pushLog('error', message);
    }
  }, [ensureMedia, pushLog]);

  const startVideoCall = useCallback(async () => {
    if (!peerRef.current?.controlOpen) {
      setError('Connect to a peer before starting a call.');
      return;
    }
    const media = ensureMedia();
    try {
      await media.startVideo();
      setCall((prev) => ({
        ...prev,
        active: true,
        kind: 'video',
        micOn: media.micEnabled,
        camOn: media.camEnabled,
        startedAt: prev.startedAt ?? Date.now(),
      }));
      pushLog('info', 'Video call started.');
    } catch (cause) {
      const message = MediaManager.describeError(cause, 'video');
      setError(message);
      pushLog('error', message);
    }
  }, [ensureMedia, pushLog]);

  const endCall = useCallback(async () => {
    await mediaRef.current?.stopAll();
    setCall(EMPTY_CALL);
    pushLog('info', 'Call ended and media tracks stopped.');
  }, [pushLog]);

  const toggleMic = useCallback(async () => {
    const media = ensureMedia();
    if (!media.hasMic) {
      await startVoiceCall();
      return;
    }
    const next = !media.micEnabled;
    await media.setMicEnabled(next);
    setCall((prev) => ({ ...prev, micOn: next, active: prev.active || next }));
  }, [ensureMedia, startVoiceCall]);

  const toggleCam = useCallback(async () => {
    const media = ensureMedia();
    if (!media.hasCamera) {
      await startVideoCall();
      return;
    }
    const next = !media.camEnabled;
    await media.setCamEnabled(next);
    setCall((prev) => ({ ...prev, camOn: next, kind: 'video', active: true }));
  }, [ensureMedia, startVideoCall]);

  const toggleScreenShare = useCallback(async () => {
    const media = ensureMedia();
    try {
      if (media.isScreenSharing) {
        await media.stopScreenShare();
        setCall((prev) => ({ ...prev, screenSharing: false }));
      } else {
        await media.startScreenShare();
        setCall((prev) => ({ ...prev, screenSharing: true, kind: 'video', active: true }));
        pushLog('info', 'Screen sharing started.');
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Screen sharing failed.';
      setError(message);
      pushLog('error', message);
    }
  }, [ensureMedia, pushLog]);

  const switchCamera = useCallback(async () => {
    await ensureMedia().switchCamera();
  }, [ensureMedia]);

  const refreshDeviceList = useCallback(async () => {
    try {
      const list = await ensureMedia().listDevices();
      setDevices(list);
    } catch {
      setDevices([]);
    }
  }, [ensureMedia]);

  /* ------------------------------------------------------------ preferences + history */

  const updatePreferences = useCallback(
    (patch: Partial<Preferences>) => {
      setPreferences((prev) => {
        const next = { ...prev, ...patch };
        savePreferences(next);
        prefsRef.current = next;
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    if (!preferences.keepHistory || !sessionRef.current || !messages.length) return;
    const session = sessionRef.current;
    const timer = window.setTimeout(() => {
      void saveConversation(session, messages, peerLabel);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [messages, peerLabel, preferences.keepHistory]);

  useEffect(() => {
    const onFocus = () => {
      focusedRef.current = document.visibilityState === 'visible';
      if (focusedRef.current) markConversationRead();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [markConversationRead]);

  useEffect(() => {
    const onUnload = () => {
      peerRef.current?.close();
      void mediaRef.current?.stopAll();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  const canCall = status === 'connected' || status === 'degraded';

  const value = useMemo<OpenCallApi>(
    () => ({
      phase,
      role,
      status,
      error,
      clearError: () => setError(null),
      localPayload,
      qrParts,
      qrIndex,
      setQrIndex,
      scannedParts: rawScanned.length,
      scanTotal: rawScanned.length ? parseChunkPart(rawScanned[0])?.total ?? 1 : 0,
      messages,
      typing,
      transfers,
      diagnostics,
      call,
      localStream,
      remoteStream,
      remoteAudioBlocked,
      resumeRemoteAudio,
      safetyCode,
      encryptionReady,
      peerLabel,
      preferences,
      devices,
      log,
      canCall,
      linkRoom,
      linkUrl,
      linkStatus,
      updatePreferences,
      startLink,
      cancelLink,
      startHost,
      startGuest,
      cancelSetup,
      submitGuestData,
      addScannedPart,
      resetScan,
      completeAsHost,
      sendMessage,
      sendTyping,
      markConversationRead,
      deleteMessage,
      clearConversation,
      sendFiles,
      cancelTransfer,
      startVoiceCall,
      startVideoCall,
      endCall,
      toggleMic,
      toggleCam,
      toggleScreenShare,
      switchCamera,
      refreshDevices: refreshDeviceList,
      disconnect,
    }),
    [
      phase,
      role,
      status,
      error,
      localPayload,
      qrParts,
      qrIndex,
      rawScanned,
      messages,
      typing,
      transfers,
      diagnostics,
      call,
      localStream,
      remoteStream,
      remoteAudioBlocked,
      resumeRemoteAudio,
      safetyCode,
      encryptionReady,
      peerLabel,
      preferences,
      devices,
      log,
      canCall,
      linkRoom,
      linkUrl,
      linkStatus,
      updatePreferences,
      startLink,
      cancelLink,
      startHost,
      startGuest,
      cancelSetup,
      submitGuestData,
      addScannedPart,
      resetScan,
      completeAsHost,
      sendMessage,
      sendTyping,
      markConversationRead,
      deleteMessage,
      clearConversation,
      sendFiles,
      cancelTransfer,
      startVoiceCall,
      startVideoCall,
      endCall,
      toggleMic,
      toggleCam,
      toggleScreenShare,
      switchCamera,
      refreshDeviceList,
      disconnect,
    ],
  );

  return (
    <OpenCallContext.Provider value={value}>
      {children}
      <audio ref={audioElementRef} autoPlay playsInline className="hidden" />
    </OpenCallContext.Provider>
  );
}
