import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

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

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ ok: false, message: 'Unauthorized' });
    return;
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET) as AuthUser;
    next();
  } catch {
    res.status(401).json({ ok: false, message: 'Invalid or expired token' });
  }
}