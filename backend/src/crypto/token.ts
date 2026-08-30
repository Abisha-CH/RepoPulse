import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { config } from '../config';

const ALGORITHM = 'aes-256-gcm';

/**
 * The 32-byte (256-bit) key used for AES-256-GCM.
 *
 * Use ENCRYPTION_KEY when set (64 hex chars or 44 base64 chars → 32 bytes);
 * otherwise derive a key deterministically from SESSION_SECRET so the deployment
 * only needs to manage one secret. Deriving is safe here because any rotation of
 * SESSION_SECRET invalidates old sessions anyway and the GitHub tokens get
 * re-encrypted on the next OAuth login of that user.
 */
function key(): Buffer {
  if (config.encryptionKey) {
    const parsed = /^[0-9a-fA-F]{64}$/.test(config.encryptionKey)
      ? Buffer.from(config.encryptionKey, 'hex')
      : Buffer.from(config.encryptionKey, 'base64');
    if (parsed.length !== 32) {
      throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes (64 hex chars).');
    }
    return parsed;
  }
  return createHash('sha256').update(['repopulse', 'token-encryption', config.sessionSecret].join(':')).digest();
}

/** Encrypt a plaintext into "base64(iv):base64(authTag):base64(ciphertext)". */
export function encryptToken(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext]
    .map((buf) => buf.toString('base64'))
    .join(':');
}

/** Reverse of encryptToken. Throws on tampering (GCM auth tag check). */
export function decryptToken(blob: string): string {
  const [ivB64, tagB64, dataB64] = blob.split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Malformed encrypted token blob.');
  }
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}