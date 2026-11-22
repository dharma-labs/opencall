import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ clients: [] as any[] }));

vi.hoisted(() => {
  // Node has no `window`; the bus reaches for it to schedule its sweeps.
  (globalThis as { window: unknown }).window = {
    setInterval: (...args: any[]) => setInterval(...(args as [any, ...any[]])),
    clearInterval: (...args: any[]) => clearInterval(...(args as [any])),
    setTimeout: (...args: any[]) => setTimeout(...(args as [any, ...any[]])),
    clearTimeout: (...args: any[]) => clearTimeout(...(args as [any])),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
});

vi.mock('mqtt', () => ({
  default: {
    connect: () => {
      const listeners: Record<string, Array<(...args: any[]) => void>> = {};
      const client: any = {
        frames: [] as Array<{ topic: string; payload: string }>,
        on(ev: string, fn: (...args: any[]) => void) {
          (listeners[ev] ??= []).push(fn);
          return client;
        },
        emit(ev: string, ...args: unknown[]) {
          for (const fn of listeners[ev] ?? []) fn(...args);
        },
        subscribe: () => Promise.resolve(),
        publish(topic: string, payload: string, _opts: unknown, cb?: () => void) {
          client.frames.push({ topic, payload });
          cb?.();
          return client;
        },
        end: () => {
          client.ended = true;
        },
        ended: false,
      };
      h.clients.push(client);
      return client;
    },
  },
}));

const { SignalBus, createRoomCode } = await import('./SignalBus');
type BusHandlers = import('./SignalBus').BusHandlers;

async function join(handlers: BusHandlers = {}) {
  const bus = new SignalBus('room9', 'Me', handlers);
  bus.connect();
  const client = h.clients[h.clients.length - 1];
  client.emit('connect');
  // The bus only awaits promises here, so a handful of microtask turns is enough.
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  return { bus, client };
}

/** A retained presence frame as the broker would hand it over. */
function deliver(client: any, id: string): void {
  const ts = Date.now();
  const payload = JSON.stringify({ id, name: 'Other', ts, born: ts });
  client.emit('message', `oc/v1/room9/p/${id}`, new TextEncoder().encode(payload));
}

describe('room codes', () => {
  it('mints a fresh, unambiguous code for every session', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const code = createRoomCode();
      expect(code).toMatch(/^[a-z0-9]{9}$/);
      // The alphabet drops these on purpose so a code read off a screen can be
      // typed on the other end without guessing.
      expect(code).not.toMatch(/[01lo]/);
      codes.add(code);
    }
    expect(codes.size).toBe(200);
  });
});

describe('offerer election', () => {
  it('gives the offer to the device that joined the room first', () => {
    const bus = new SignalBus('room1', 'Me');
    const joined = bus.self.born ?? 0;
    expect(bus.electOfferer({ id: 'peer', name: 'Other', ts: Date.now(), born: joined + 4_000 })).toBe(true);
    expect(bus.electOfferer({ id: 'peer', name: 'Other', ts: Date.now(), born: joined - 4_000 })).toBe(false);
  });

  it('does not change hands while presence heartbeats cross', () => {
    const bus = new SignalBus('room1', 'Me');
    const peer = { id: 'peer', name: 'Other', ts: Date.now() - 60_000, born: (bus.self.born ?? 0) + 4_000 };
    const first = bus.electOfferer(peer);
    peer.ts = Date.now() + 120_000;
    expect(bus.electOfferer(peer)).toBe(first);
  });

  it('still picks exactly one side against a peer that sends no join time', () => {
    const bus = new SignalBus('room1', 'Me');
    expect(bus.electOfferer({ id: 'peer', name: 'Other', ts: Date.now() })).toBe(false);
  });
});

/** A frame the broker would hand over on the direct topic of `to`. */
function deliverDirect(client: any, from: string, to: string): void {
  const payload = JSON.stringify({ k: 'ice', from, d: { candidate: 'candidate:1 1 udp 1 127.0.0.1 9 typ host' } });
  client.emit('message', `oc/v1/room9/d/${to}`, new TextEncoder().encode(payload));
}

function dial(handlers: BusHandlers = {}) {
  const before = h.clients.length;
  const bus = new SignalBus('room9', 'Me', handlers);
  bus.connect();
  return { bus, clients: h.clients.slice(before) };
}

describe('broker race', () => {
  it('keeps the broker that answered and hangs up the other', async () => {
    const signals: string[] = [];
    const { bus, client } = await join({ onSignal: (s) => signals.push(s.kind) });
    const loser = h.clients[h.clients.length - 2];

    expect(loser).toBeDefined();
    expect(loser.ended).toBe(true);
    expect(client.ended).toBe(false);

    // The winner is the only socket the session listens on.
    deliverDirect(loser, 'abc123', bus.self.id);
    expect(signals).toEqual([]);
    deliverDirect(client, 'abc123', bus.self.id);
    expect(signals).toEqual(['ice']);
    bus.close();
  });

  it('does not report a failure while another broker can still answer', () => {
    const errors: string[] = [];
    const { bus, clients } = dial({ onError: (m) => errors.push(m) });
    expect(clients.length).toBe(2);

    clients[0].emit('error', new Error('broker refused'));
    expect(errors).toEqual([]);
    clients[1].emit('error', new Error('this one too'));
    expect(errors).toEqual(['this one too']);
    bus.close();
  });

  it('stops dialling when the session is closed before anything answered', () => {
    const { bus, clients } = dial();
    bus.close();
    expect(clients.every((client) => client.ended)).toBe(true);
  });
});

describe('room presence', () => {
  // Fake timers freeze `Date.now()` too, which makes the retained-burst window
  // and the stale sweep deterministic instead of dependent on test speed.
  it('pairs with a live device while nine ghosts sit in the room', async () => {
    vi.useFakeTimers();
    try {
      const partners: string[] = [];
      const crowded: number[] = [];
      const { bus, client } = await join({
        onPeer: (peer, first) => {
          if (first) partners.push(peer.id);
        },
        onCrowded: (count) => crowded.push(count),
      });

      // Retained frames from tabs that are gone: they land in the opening burst
      // and never repeat, so the room must not read them as full.
      for (let i = 0; i < 9; i += 1) deliver(client, `ghost${i}`);
      expect(crowded).toEqual([]);
      expect(partners).toEqual([]);

      deliver(client, 'real');
      deliver(client, 'real');
      expect(partners).toEqual(['real']);
      expect(crowded).toEqual([]);
      bus.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses the device that would make three', async () => {
    vi.useFakeTimers();
    try {
      const crowded: number[] = [];
      const partners: string[] = [];
      const { bus, client } = await join({
        onPeer: (peer, first) => {
          if (first) partners.push(peer.id);
        },
        onCrowded: (count) => crowded.push(count),
      });

      deliver(client, 'first');
      deliver(client, 'first');
      deliver(client, 'second');
      deliver(client, 'second');
      expect(partners).toEqual(['first']);
      expect(crowded).toEqual([3]);
      bus.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('blanks a frame that stopped announcing itself', async () => {
    vi.useFakeTimers();
    try {
      const gone: string[] = [];
      const { bus, client } = await join({ onPeerGone: (id, bye) => gone.push(`${id}:${String(bye)}`) });
      deliver(client, 'quiet');
      deliver(client, 'quiet');

      await vi.advanceTimersByTimeAsync(61_000);
      // Silence, not a goodbye: an open line must not be torn down over it.
      expect(gone).toEqual(['quiet:false']);
      expect(client.frames).toContainEqual({ topic: 'oc/v1/room9/p/quiet', payload: '' });
      bus.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('calls an empty frame a goodbye', async () => {
    const gone: string[] = [];
    const { bus, client } = await join({ onPeerGone: (id, bye) => gone.push(`${id}:${String(bye)}`) });
    deliver(client, 'leaving');
    client.emit('message', 'oc/v1/room9/p/leaving', new TextEncoder().encode(''));
    expect(gone).toEqual(['leaving:true']);
    bus.close();
  });

  it('makes room for a new device once a silent one is dropped', async () => {
    vi.useFakeTimers();
    try {
      const partners: string[] = [];
      const crowded: number[] = [];
      const { bus, client } = await join({
        onPeer: (peer, first) => {
          if (first) partners.push(peer.id);
        },
        onCrowded: (count) => crowded.push(count),
      });

      deliver(client, 'first');
      deliver(client, 'first');
      deliver(client, 'second');
      deliver(client, 'second');
      expect(crowded).toEqual([3]);

      // `first` and `second` both go quiet; the sweep blanks them and frees the room.
      await vi.advanceTimersByTimeAsync(61_000);
      deliver(client, 'third');
      deliver(client, 'third');
      expect(partners).toEqual(['first', 'third']);
      expect(crowded).toEqual([3]);
      bus.close();
    } finally {
      vi.useRealTimers();
    }
  });
});
