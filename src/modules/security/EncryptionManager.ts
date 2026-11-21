import { asBuffer, base64ToBytes, bytesToBase64, sha256Hex, utf8Decode, utf8Encode } from '../../utils';

const HKDF_INFO = 'opencall/v1/data';

/**
 * Application-level encryption on top of WebRTC's mandatory DTLS/SRTP layer.
 *
 * Uses only browser-native WebCrypto primitives: ECDH P-256 for the key
 * agreement, HKDF-SHA256 to derive the channel key and AES-256-GCM for the
 * authenticated payload encryption. No cryptographic primitive is invented here.
 */
export class EncryptionManager {
  private keyPair: CryptoKeyPair | null = null;
  private aesKey: CryptoKey | null = null;
  private ownPublic = '';
  private peerPublic = '';
  private code = '';

  static async create(): Promise<EncryptionManager> {
    const manager = new EncryptionManager();
    manager.keyPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits'],
    );
    const raw = await crypto.subtle.exportKey('raw', manager.keyPair.publicKey);
    manager.ownPublic = bytesToBase64(new Uint8Array(raw));
    return manager;
  }

  get publicKey(): string {
    return this.ownPublic;
  }

  get ready(): boolean {
    return this.aesKey !== null;
  }

  get peerPublicKey(): string {
    return this.peerPublic;
  }

  /** Short human-comparable safety code derived from both public keys. */
  get safetyCode(): string {
    return this.code;
  }

  async deriveSharedKey(peerPublicBase64: string): Promise<string> {
    if (!this.keyPair) throw new Error('No local key pair has been generated.');
    if (peerPublicBase64 === this.ownPublic) throw new Error('Peer key equals the local key.');
    this.peerPublic = peerPublicBase64;

    const peerKey = await crypto.subtle.importKey(
      'raw',
      asBuffer(base64ToBytes(peerPublicBase64)),
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    );
    const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: peerKey }, this.keyPair.privateKey, 256);
    const salt = [this.ownPublic, peerPublicBase64].sort().join('|');
    const material = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
    this.aesKey = await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: asBuffer(utf8Encode(salt)), info: asBuffer(utf8Encode(HKDF_INFO)) },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    this.code = await safetyCode(this.ownPublic, peerPublicBase64);
    return this.code;
  }

  async encrypt(plaintext: string): Promise<{ iv: string; ct: string }> {
    if (!this.aesKey) throw new Error('Encryption is not ready.');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: asBuffer(iv) }, this.aesKey, asBuffer(utf8Encode(plaintext)));
    return { iv: bytesToBase64(iv), ct: bytesToBase64(new Uint8Array(cipher)) };
  }

  async decrypt(ivBase64: string, cipherBase64: string): Promise<string> {
    if (!this.aesKey) throw new Error('Encryption is not ready.');
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: asBuffer(base64ToBytes(ivBase64)) },
      this.aesKey,
      asBuffer(base64ToBytes(cipherBase64)),
    );
    return utf8Decode(new Uint8Array(plain));
  }

  reset(): void {
    this.aesKey = null;
    this.peerPublic = '';
    this.code = '';
  }
}

/** Deterministic, order-independent 20-digit code both peers can compare out of band. */
export async function safetyCode(a: string, b: string): Promise<string> {
  const hex = await sha256Hex(`${[a, b].sort().join('|')}`);
  let digits = '';
  for (let i = 0; i < hex.length && digits.length < 20; i += 2) {
    digits += (Number.parseInt(hex.slice(i, i + 2), 16) % 100).toString().padStart(2, '0');
  }
  const groups = digits.slice(0, 20).match(/.{1,5}/g) ?? [];
  return groups.join(' ');
}
