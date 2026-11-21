import { describe, expect, it, vi } from 'vitest';

vi.mock('mqtt', () => ({ default: { connect: vi.fn() } }));

const { SignalBus } = await import('./SignalBus');

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
