import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The suite runs in node, but the session schedules through `window`.
(globalThis as { window: unknown }).window = globalThis;

const h = vi.hoisted(() => ({ buses: [] as any[] }));

vi.mock('./SignalBus', () => ({
  DEFAULT_BROKERS: [],
  SignalBus: class {
    self = { id: 'me' };
    send = vi.fn();
    connect = vi.fn();
    refresh = vi.fn();
    close = vi.fn();
    electOfferer = vi.fn(() => true);
    constructor(_room: string, _name: string, handlers: any) {
      this.handlers = handlers;
      h.buses.push(this);
    }
    handlers: any;
    /** Deliver a presence record the way the broker would. */
    appear(id = 'peer', name = 'Other device'): void {
      this.handlers.onPeer({ id, name, ts: Date.now() }, true);
    }
    /** Deliver a signal frame the way the broker would. */
    receive(kind: string, data: unknown, from = 'peer'): void {
      this.handlers.onSignal({ kind, from, data });
    }
  },
}));

const { LinkSession } = await import('./LinkSession');

function fakePeer() {
  return {
    pc: { remoteDescription: null as unknown },
    controlOpen: false,
    createDataChannels: vi.fn(),
    listenForDataChannels: vi.fn(),
    setCandidateSink: vi.fn(),
    createOfferTrickle: vi.fn(async () => ({ type: 'offer', sdp: 'v=0\r\n' })),
    acceptAnswerTrickle: vi.fn(async () => {}),
    addRemoteCandidates: vi.fn(async () => {}),
    close: vi.fn(),
  };
}

function build() {
  const peers: ReturnType<typeof fakePeer>[] = [];
  const statuses: string[] = [];
  const errors: string[] = [];
  const session = new LinkSession({
    room: 'abc123',
    displayName: 'Me',
    makePeer: () => {
      const peer = fakePeer();
      peers.push(peer);
      return peer as never;
    },
    handlers: {
      onStatus: (message) => statuses.push(message),
      onError: (message) => errors.push(message),
    },
  });
  session.start();
  const bus = h.buses[h.buses.length - 1];
  bus.appear();
  return { session, peers, statuses, errors, bus };
}

describe('LinkSession connect deadline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.buses.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('restarts the handshake when no path opens, without waiting for an ICE failure', async () => {
    const { peers, statuses, bus } = build();
    expect(peers[0].createOfferTrickle).toHaveBeenCalled();

    bus.receive('answer', { type: 'answer', sdp: 'v=0\r\n' });
    // The browser never reports failure for unreachable candidates, so the
    // deadline is the only thing that can recover this call.
    await vi.advanceTimersByTimeAsync(15_000);

    expect(peers[0].close).toHaveBeenCalled();
    expect(peers.length).toBe(2);
    expect(statuses).toContain('Retrying the direct path…');
    expect(peers[1].createOfferTrickle).toHaveBeenCalled();
  });

  it('reports the failure once the attempts run out', async () => {
    const { peers, errors, bus } = build();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      bus.receive('answer', { type: 'answer', sdp: 'v=0\r\n' });
      await vi.advanceTimersByTimeAsync(15_000);
    }

    expect(peers.length).toBe(3);
    expect(errors.at(-1)).toContain('No path was found between the two devices');
  });

  it('drops the deadline once the peer connection is live', async () => {
    const { session, peers, statuses, bus } = build();
    bus.receive('answer', { type: 'answer', sdp: 'v=0\r\n' });
    await vi.advanceTimersByTimeAsync(4_000);
    session.markConnected();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(peers.length).toBe(1);
    expect(peers[0].close).not.toHaveBeenCalled();
    expect(statuses).not.toContain('Retrying the direct path…');
  });
});
