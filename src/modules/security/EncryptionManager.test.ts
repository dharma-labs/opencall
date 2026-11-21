import { describe, expect, it } from 'vitest';
import { EncryptionManager, safetyCode } from './EncryptionManager';

/** Simulates the two peers exchanging public keys and deriving a shared channel. */
async function establishPair() {
  const alice = await EncryptionManager.create();
  const bob = await EncryptionManager.create();
  const aliceCode = await alice.deriveSharedKey(bob.publicKey);
  const bobCode = await bob.deriveSharedKey(alice.publicKey);
  return { alice, bob, aliceCode, bobCode };
}

describe('EncryptionManager', () => {
  it('keeps local and peer public keys distinct', async () => {
    const { alice, bob } = await establishPair();
    expect(alice.publicKey).not.toBe(bob.publicKey);
  });

  it('derives a key on both sides and encrypts/decrypts across peers', async () => {
    const { alice, bob } = await establishPair();
    expect(alice.ready).toBe(true);
    expect(bob.ready).toBe(true);

    const secret = JSON.stringify({ t: 'msg', text: 'classified payload ☕' });
    const sealed = await alice.encrypt(secret);
    expect(sealed.ct).not.toContain('classified');

    expect(await bob.decrypt(sealed.iv, sealed.ct)).toBe(secret);
  });

  it('rejects ciphertext that has been tampered with', async () => {
    const { alice, bob } = await establishPair();
    const sealed = await alice.encrypt('integrity matters');
    const bytes = Buffer.from(sealed.ct, 'base64');
    bytes[bytes.length - 1] ^= 0xff;
    const tampered = bytes.toString('base64');

    await expect(bob.decrypt(sealed.iv, tampered)).rejects.toThrow();
  });

  it('produces the same safety code on both ends', async () => {
    const { aliceCode, bobCode } = await establishPair();
    expect(aliceCode).toBe(bobCode);
    expect(aliceCode).toMatch(/^\d{5} \d{5} \d{5} \d{5}$/);
  });

  it('computes the safety code independently of key order', async () => {
    const a = 'AAAA';
    const b = 'BBBB';
    expect(await safetyCode(a, b)).toBe(await safetyCode(b, a));
  });

  it('refuses to derive a key from its own public key', async () => {
    const alice = await EncryptionManager.create();
    await expect(alice.deriveSharedKey(alice.publicKey)).rejects.toThrow();
  });
});
