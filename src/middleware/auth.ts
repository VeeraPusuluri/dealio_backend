import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { Session } from '@prisma/client';
import prisma from '../utils/prisma';

const JWT_SECRET = process.env.JWT_SECRET || 'dealio-secret-key-12345';

export interface AuthUser {
  id: number;
  phone: string;
  role: string;
  name: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      authSession?: Session;
    }
  }
}

// Resolves token from Authorization header OR ?token= query param.
// The query-param path is needed for SSE: browsers cannot set custom headers
// on EventSource connections.
function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  const q = req.query.token;
  if (typeof q === 'string' && q.length > 0) return q;
  return null;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ ok: false, message: 'Unauthorized' });
    return;
  }

  let payload: AuthUser & { jti?: string };
  try {
    payload = jwt.verify(token, JWT_SECRET) as AuthUser & { jti?: string };
  } catch {
    res.status(401).json({ ok: false, message: 'Invalid or expired token' });
    return;
  }

  // Session-backed tokens carry a `jti`. Reject if that session was revoked
  // (the device was signed out) or deleted. Tokens issued before device
  // management (no jti) keep working so existing logins aren't dropped.
  if (payload.jti) {
    try {
      const session = await prisma.session.findUnique({ where: { jti: payload.jti } });
      if (!session || session.revokedAt) {
        res.status(401).json({ ok: false, message: 'Session ended. Please sign in again.' });
        return;
      }
      req.authSession = session;
      // "Last seen" — update at most once every 5 min, fire-and-forget.
      if (Date.now() - session.lastSeenAt.getTime() > 5 * 60 * 1000) {
        prisma.session
          .update({ where: { id: session.id }, data: { lastSeenAt: new Date(), ip: req.ip ?? session.ip } })
          .catch(() => {});
      }
    } catch {
      res.status(500).json({ ok: false, message: 'Auth check failed' });
      return;
    }
  }

  req.user = { id: payload.id, phone: payload.phone, role: payload.role, name: payload.name };
  next();
}