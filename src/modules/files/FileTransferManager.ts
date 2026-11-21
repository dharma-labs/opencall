import type { FileTransfer, TransferState } from '../../types';
import { delay, formatBytes, sha256Hex, uid } from '../../utils';
import type { InnerMessage } from '../messaging/MessageProtocol';

export const CHUNK_SIZE = 16 * 1024;
export const HIGH_WATER_MARK = 1024 * 1024;
export const LOW_WATER_MARK = 256 * 1024;
export const MAX_FILE_BYTES = 512 * 1024 * 1024;
const HASH_VERIFY_LIMIT = 128 * 1024 * 1024;
const HEADER_BYTES = 8;

interface Outgoing {
  id: string;
  slot: number;
  file: File;
  offset: number;
  chunkIndex: number;
  retries: number;
  cancelled: boolean;
  hashed: string | null;
}

interface Incoming {
  id: string;
  slot: number;
  name: string;
  size: number;
  mime: string;
  chunks: number;
  received: number;
  parts: (ArrayBuffer | undefined)[];
  hash: string | null;
  doneEmitted: boolean;
  cancelled: boolean;
}

export interface TransferEvents {
  onCreate: (transfer: FileTransfer) => void;
  onUpdate: (id: string, patch: Partial<FileTransfer>) => void;
}

export interface TransferTransport {
  sendControl: (inner: InnerMessage) => Promise<void>;
  sendBinary: (frame: ArrayBuffer) => boolean;
  bufferedAmount: () => number;
  chunkSize?: number;
}

/**
 * Chunked, backpressure-aware file transfer over the RTCDataChannel.
 *
 * Each chunk is prefixed with an 8 byte header: `uint32 slot`, `uint32 chunkIndex`.
 * The slot identifies the transfer, so several files can be in flight at once
 * without either peer guessing which chunk belongs where.
 */
export class FileTransferManager {
  private outgoing = new Map<string, Outgoing>();
  private incoming = new Map<string, Incoming>();
  private bySlot = new Map<number, string>();
  private queue: string[] = [];
  private pumping = false;
  private nextSlot = 1;
  private closed = false;
  private chunkSize: number;

  constructor(
    private transport: TransferTransport,
    private events: TransferEvents,
  ) {
    this.chunkSize = transport.chunkSize ?? CHUNK_SIZE;
  }

  get activeCount(): number {
    return this.outgoing.size + this.incoming.size;
  }

  async sendFile(file: File): Promise<string> {
    if (this.closed) throw new Error('The connection is closed.');
    if (file.size > MAX_FILE_BYTES) {
      throw new Error(`"${file.name}" is ${formatBytes(file.size)} which exceeds the ${formatBytes(MAX_FILE_BYTES)} limit.`);
    }
    if (!this.transport.sendBinary) throw new Error('No file channel is available.');

    const id = uid();
    const slot = this.nextSlot;
    this.nextSlot += 1;
    const chunks = Math.max(1, Math.ceil(file.size / this.chunkSize));

    const record: Outgoing = { id, slot, file, offset: 0, chunkIndex: 0, retries: 0, cancelled: false, hashed: null };
    this.outgoing.set(id, record);
    this.bySlot.set(slot, id);
    this.events.onCreate({
      id,
      name: file.name,
      size: file.size,
      mime: file.type || 'application/octet-stream',
      direction: 'sending',
      transferred: 0,
      state: 'active',
      startedAt: Date.now(),
    });

    await this.transport.sendControl({
      t: 'file-meta',
      id,
      slot,
      name: file.name,
      size: file.size,
      mime: file.type || 'application/octet-stream',
      chunks,
      ts: Date.now(),
    });

    this.queue.push(id);
    void this.pump();
    return id;
  }

  private async pump(): Promise<void> {
    if (this.pumping || this.closed) return;
    this.pumping = true;
    try {
      while (this.queue.length && !this.closed) {
        const id = this.queue[0];
        const record = this.outgoing.get(id);
        if (!record || record.cancelled) {
          this.queue.shift();
          continue;
        }

        let aborted = false;
        while (record.offset < record.file.size) {
          if (record.cancelled || this.closed) {
            aborted = true;
            break;
          }
          while (this.transport.bufferedAmount() > HIGH_WATER_MARK) {
            if (record.cancelled || this.closed) break;
            await delay(40);
          }
          if (record.cancelled || this.closed) {
            aborted = true;
            break;
          }

          const slice = record.file.slice(record.offset, record.offset + this.chunkSize);
          const data = await slice.arrayBuffer();
          const frame = new Uint8Array(HEADER_BYTES + data.byteLength);
          const view = new DataView(frame.buffer);
          view.setUint32(0, record.slot);
          view.setUint32(4, record.chunkIndex);
          frame.set(new Uint8Array(data), HEADER_BYTES);

          if (!this.transport.sendBinary(frame.buffer)) {
            record.retries += 1;
            if (record.retries > 150) {
              aborted = true;
              break;
            }
            await delay(120);
            continue;
          }

          record.retries = 0;
          record.offset += data.byteLength;
          record.chunkIndex += 1;
          this.events.onUpdate(id, { transferred: record.offset });
        }

        this.queue.shift();

        if (aborted || record.cancelled) continue;

        try {
          record.hashed = record.file.size <= HASH_VERIFY_LIMIT
            ? await sha256Hex(new Uint8Array(await record.file.arrayBuffer()))
            : null;
        } catch {
          record.hashed = null;
        }

        if (record.cancelled || this.closed) continue;

        await this.transport.sendControl({ t: 'file-done', id, hash: record.hashed, ts: Date.now() });
        this.outgoing.delete(id);
        this.bySlot.delete(record.slot);
        this.settle(id, 'complete');
      }
    } finally {
      this.pumping = false;
    }
  }

  /** Handles a binary chunk received on the file channel. */
  handleBinary(buffer: ArrayBuffer): void {
    if (buffer.byteLength <= HEADER_BYTES) return;
    const view = new DataView(buffer);
    const slot = view.getUint32(0);
    const chunkIndex = view.getUint32(4);
    const transferId = this.bySlot.get(slot);
    if (!transferId) return;

    const target = this.incoming.get(transferId);
    if (!target || target.cancelled) return;
    if (chunkIndex >= target.chunks) return;
    if (target.parts[chunkIndex]) return;

    const payload = buffer.slice(HEADER_BYTES);
    target.parts[chunkIndex] = payload;
    target.received += payload.byteLength;
    this.events.onUpdate(transferId, { transferred: Math.min(target.received, target.size) });

    if (target.received >= target.size) {
      void this.finishIncoming(target);
    }
  }

  /** Handles the control-channel portion of the file protocol. Returns true when consumed. */
  handleControl(inner: InnerMessage): boolean {
    if (inner.t === 'file-meta') {
      const incoming: Incoming = {
        id: inner.id,
        slot: inner.slot,
        name: inner.name,
        size: inner.size,
        mime: inner.mime,
        chunks: inner.chunks,
        received: 0,
        parts: new Array(inner.chunks),
        hash: null,
        doneEmitted: false,
        cancelled: false,
      };
      this.incoming.set(inner.id, incoming);
      this.bySlot.set(inner.slot, inner.id);
      this.events.onCreate({
        id: inner.id,
        name: inner.name,
        size: inner.size,
        mime: inner.mime,
        direction: 'receiving',
        transferred: 0,
        state: 'active',
        startedAt: Date.now(),
      });
      return true;
    }

    if (inner.t === 'file-done') {
      const target = this.incoming.get(inner.id);
      if (target) {
        target.hash = inner.hash;
        void this.finishIncoming(target);
      }
      return true;
    }

    if (inner.t === 'file-cancel') {
      const outgoing = this.outgoing.get(inner.id);
      if (outgoing) {
        outgoing.cancelled = true;
        this.outgoing.delete(inner.id);
        this.bySlot.delete(outgoing.slot);
        this.settle(inner.id, 'failed', inner.reason || 'Cancelled by the other device');
      }
      const incoming = this.incoming.get(inner.id);
      if (incoming) {
        incoming.cancelled = true;
        this.incoming.delete(inner.id);
        this.bySlot.delete(incoming.slot);
        this.settle(inner.id, 'failed', inner.reason || 'Cancelled by the other device');
      }
      return true;
    }

    return false;
  }

  cancel(id: string): void {
    const outgoing = this.outgoing.get(id);
    if (outgoing) {
      outgoing.cancelled = true;
      this.outgoing.delete(id);
      this.bySlot.delete(outgoing.slot);
      void this.transport.sendControl({ t: 'file-cancel', id, reason: 'Cancelled by the sender', ts: Date.now() });
      this.settle(id, 'cancelled');
      return;
    }
    const incoming = this.incoming.get(id);
    if (incoming) {
      incoming.cancelled = true;
      this.incoming.delete(id);
      this.bySlot.delete(incoming.slot);
      void this.transport.sendControl({ t: 'file-cancel', id, reason: 'Cancelled by the receiver', ts: Date.now() });
      this.settle(id, 'cancelled');
    }
  }

  private settle(id: string, state: TransferState, error?: string): void {
    this.events.onUpdate(id, { state, error, endedAt: Date.now() });
  }

  private async finishIncoming(target: Incoming): Promise<void> {
    if (target.doneEmitted || target.cancelled) return;
    if (target.received < target.size) return;
    target.doneEmitted = true;

    const ordered = target.parts.filter((part): part is ArrayBuffer => part instanceof ArrayBuffer);
    this.incoming.delete(target.id);
    this.bySlot.delete(target.slot);
    target.parts = [];

    const assembled = new Uint8Array(target.size);
    let cursor = 0;
    for (const part of ordered) {
      const bytes = new Uint8Array(part);
      assembled.set(bytes, cursor);
      cursor += bytes.byteLength;
    }

    let verified: boolean | undefined;
    if (target.hash && assembled.byteLength <= HASH_VERIFY_LIMIT) {
      try {
        verified = (await sha256Hex(assembled)) === target.hash;
      } catch {
        verified = undefined;
      }
    }

    let url: string | undefined;
    if (assembled.byteLength <= HASH_VERIFY_LIMIT) {
      try {
        const blob = new Blob([assembled as unknown as BlobPart], { type: target.mime });
        url = URL.createObjectURL(blob);
      } catch {
        url = undefined;
      }
    }

    this.events.onUpdate(target.id, {
      state: verified === false ? 'failed' : 'complete',
      transferred: target.size,
      verified,
      url,
      endedAt: Date.now(),
      error: verified === false ? 'Integrity check failed (file may be corrupted).' : undefined,
    });
  }

  reset(): void {
    this.closed = true;
    this.outgoing.clear();
    this.incoming.clear();
    this.bySlot.clear();
    this.queue = [];
  }
}
