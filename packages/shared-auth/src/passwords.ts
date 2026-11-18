import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

/**
 * Password hashing using Node.js scrypt with salt.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('base64');
  const derived = scryptSync(password, salt, 64).toString('base64');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, hash: string): boolean {
  if (!hash.startsWith('scrypt$')) return false;
  const parts = hash.split('$');
  if (parts.length !== 3) return false;
  const [, salt, expectedDerived] = parts;
  const actualDerived = scryptSync(password, salt, 64).toString('base64');
  const bufA = Buffer.from(expectedDerived, 'base64');
  const bufB = Buffer.from(actualDerived, 'base64');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
