import crypto from 'crypto';
import prisma from '../utils/prisma';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function createEmailVerification(userId: number, email: string) {
  const token = crypto.randomBytes(20).toString('hex');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  // Remove old tokens for this user
  await prisma.emailVerification.deleteMany({ where: { userId } });

  const rec = await prisma.emailVerification.create({
    data: { userId, token, email, expiresAt },
  });
  return rec.token;
}

export async function verifyEmailToken(token: string) {
  const rec = await prisma.emailVerification.findUnique({ where: { token } });
  if (!rec) return { ok: false, reason: 'Invalid token' };
  if (rec.expiresAt < new Date()) {
    await prisma.emailVerification.deleteMany({ where: { userId: rec.userId } });
    return { ok: false, reason: 'Token expired' };
  }

  // Mark user's email as verified if it matches
  await prisma.user.update({ where: { id: rec.userId }, data: { email: rec.email, emailVerified: true } });

  // Cleanup tokens
  await prisma.emailVerification.deleteMany({ where: { userId: rec.userId } });
  return { ok: true, userId: rec.userId };
}
