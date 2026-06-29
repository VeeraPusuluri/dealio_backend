import { Request, Response } from 'express';
import prisma from '../utils/prisma';

/** Device / session management for the currently authenticated user. */
export const sessionController = {
  // GET /auth/sessions — active (non-revoked) devices, newest activity first.
  list: async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const sessions = await prisma.session.findMany({
      where: { userId, revokedAt: null },
      orderBy: { lastSeenAt: 'desc' },
    });
    const currentId = req.authSession?.id;
    res.json({
      ok: true,
      data: sessions.map((s) => ({
        id: s.id,
        deviceName: s.deviceName,
        ip: s.ip,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        current: s.id === currentId,
      })),
    });
  },

  // DELETE /auth/sessions/:id — sign out a specific device.
  revoke: async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ ok: false, message: 'Invalid session id' });
      return;
    }
    const session = await prisma.session.findFirst({ where: { id, userId } });
    if (!session) {
      res.status(404).json({ ok: false, message: 'Session not found' });
      return;
    }
    if (!session.revokedAt) {
      await prisma.session.update({ where: { id }, data: { revokedAt: new Date() } });
    }
    res.json({ ok: true, message: 'Device signed out' });
  },

  // DELETE /auth/sessions — sign out every device except the current one.
  revokeOthers: async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const currentId = req.authSession?.id ?? -1;
    const { count } = await prisma.session.updateMany({
      where: { userId, revokedAt: null, NOT: { id: currentId } },
      data: { revokedAt: new Date() },
    });
    res.json({
      ok: true,
      message: `Signed out of ${count} other device${count === 1 ? '' : 's'}`,
      data: { count },
    });
  },

  // POST /auth/logout — sign out (revoke) the current device's session.
  logout: async (req: Request, res: Response) => {
    if (req.authSession && !req.authSession.revokedAt) {
      await prisma.session.update({ where: { id: req.authSession.id }, data: { revokedAt: new Date() } });
    }
    res.json({ ok: true, message: 'Logged out' });
  },
};
