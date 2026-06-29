import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import prisma from '../utils/prisma';

const JWT_SECRET = process.env.JWT_SECRET || 'dealio-secret-key-12345';
const EXPIRES_IN_SEC = 7 * 24 * 60 * 60; // 7 days

export interface DeviceInfo {
  userAgent?: string | null | undefined;
  ip?: string | null | undefined;
}

/** Best-effort friendly device label from a User-Agent string. */
export function deviceNameFromUA(ua?: string | null): string {
  if (!ua) return 'Unknown device';
  const s = ua.toLowerCase();

  let os = 'Unknown OS';
  if (/ipad/.test(s)) os = 'iPad';
  else if (/iphone|ipod/.test(s)) os = 'iPhone';
  else if (/android/.test(s)) os = 'Android';
  else if (/windows/.test(s)) os = 'Windows';
  else if (/mac os x|macintosh/.test(s)) os = 'macOS';
  else if (/cros/.test(s)) os = 'ChromeOS';
  else if (/linux/.test(s)) os = 'Linux';

  let app = 'browser';
  if (/dealio|okhttp|cfnetwork|dart|expo|reactnative/.test(s)) app = 'Dealio app';
  else if (/edg\//.test(s)) app = 'Edge';
  else if (/opr\/|opera/.test(s)) app = 'Opera';
  else if (/chrome|crios/.test(s)) app = 'Chrome';
  else if (/firefox|fxios/.test(s)) app = 'Firefox';
  else if (/safari/.test(s)) app = 'Safari';

  return app === 'browser' ? `Browser on ${os}` : `${app} on ${os}`;
}

export interface SessionUser {
  id: number;
  phone: string;
  role: string;
  fullName: string | null;
}

/**
 * Create a Session row for this login and return a JWT whose `jti` claim points
 * at it. The auth middleware validates the session on every request, so the
 * device can be signed out later by revoking the row.
 */
export async function issueSession(
  user: SessionUser,
  device?: DeviceInfo
): Promise<{ token: string; expiresIn: number }> {
  const jti = randomBytes(16).toString('hex');

  await prisma.session.create({
    data: {
      jti,
      userId: user.id,
      deviceName: deviceNameFromUA(device?.userAgent),
      userAgent: device?.userAgent ?? null,
      ip: device?.ip ?? null,
    },
  });

  const token = jwt.sign(
    { id: user.id, phone: user.phone, role: user.role, name: user.fullName },
    JWT_SECRET,
    { expiresIn: '7d', jwtid: jti }
  );

  return { token, expiresIn: EXPIRES_IN_SEC };
}
