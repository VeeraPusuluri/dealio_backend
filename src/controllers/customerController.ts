import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { channelManager } from '../services/channelManager';

export const customerController = {
  getCities: async (req: Request, res: Response) => {
    const projects = await prisma.project.findMany({
      select: { city: true },
      where: { published: true }
    });
    const cities = Array.from(new Set(projects.map(p => p.city).filter(Boolean)));
    const defaultCities = ['Hyderabad', 'Bengaluru', 'Mumbai', 'Pune', 'Delhi NCR', 'Chennai'];
    res.json({ ok: true, data: cities.length > 0 ? cities : defaultCities });
  },

  getProjects: async (req: Request, res: Response) => {
    const { city } = req.query;
    const projects = await prisma.project.findMany({
      where: {
        published: true,
        ...(city ? { city: { equals: city as string, mode: 'insensitive' } } : {})
      }
    });
    res.json({ ok: true, data: projects });
  },

  getProject: async (req: Request, res: Response) => {
    const { id } = req.params;
    const numId = Number(id);
    if (!id || isNaN(numId)) {
      res.status(404).json({ ok: false, message: 'Project not found' });
      return;
    }
    const project = await prisma.project.findUnique({
      where: { id: numId },
      include: {
        builder: {
          select: {
            companyName: true, about: true, yearEstablished: true,
            deliveredProjects: true, website: true, contactPhone: true, contactEmail: true,
            user: { select: { fullName: true } },
          },
        },
      },
    });
    if (project) {
      const { priceFrom, priceTo, builder, ...rest } = project as any;
      // Ensure JSON array fields are proper arrays (Prisma returns JsonValue)
      const amenities = Array.isArray(rest.amenities) ? rest.amenities : null;
      const configurations = Array.isArray(rest.configurations) ? rest.configurations : null;
      const nearbyHighlights = Array.isArray(rest.nearbyHighlights) ? rest.nearbyHighlights : null;
      res.json({ ok: true, data: {
        ...rest,
        amenities,
        configurations,
        nearbyHighlights,
        priceMin:    priceFrom ?? null,
        priceMax:    priceTo   ?? null,
        builderName:              builder?.companyName || builder?.user?.fullName || null,
        builderAbout:             builder?.about             ?? null,
        builderYearEstablished:   builder?.yearEstablished   ?? null,
        builderDeliveredProjects: builder?.deliveredProjects ?? null,
        builderWebsite:           builder?.website           ?? null,
        builderContactPhone:      builder?.contactPhone      ?? null,
        builderContactEmail:      builder?.contactEmail      ?? null,
      }});
    } else {
      res.status(404).json({ ok: false, message: 'Project not found' });
    }
  },

  // SSE endpoint — long-lived connection, one per logged-in customer tab.
  // The browser cannot send custom headers on EventSource, so the JWT is
  // accepted as a ?token= query param (requireAuth already handles this).
  subscribeToCity: async (req: Request, res: Response) => {
    const userId = req.user!.id;

    // SSE handshake
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
    res.flushHeaders();

    // Look up the user's preferred city
    const dbUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { preferredCity: true }
    });
    const city = dbUser?.preferredCity ?? null;

    // Send initial "connected" frame so the client knows the socket is live
    res.write(`data: ${JSON.stringify({
      type: 'connected',
      city,
      title: '',
      message: city ? `Subscribed to ${city}` : 'Connected (no city preference set)',
      timestamp: new Date().toISOString()
    })}\n\n`);

    // Register in the channel
    if (city) channelManager.subscribe(city, userId, res);

    // Keep-alive comment every 25 s (proxies close idle SSE connections)
    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { clearInterval(heartbeat); }
    }, 25_000);

    // Cleanup when the browser closes the tab / navigates away
    req.on('close', () => {
      clearInterval(heartbeat);
      if (city) channelManager.unsubscribe(city, userId);
    });
  },

  setPreferredCity: async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { city } = req.body;
    await prisma.user.update({
      where: { id: userId },
      data: { preferredCity: city || null }
    });
    res.json({ ok: true });
    // The frontend reconnects the SSE after calling this, so the new city is
    // picked up automatically on the next connection.
  },

  updateProfile: async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { email } = req.body;

    const current = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    const newEmail = (email || null) as string | null;

    // If the new email is already used by another account, fail with a 400
    if (newEmail) {
      const conflict = await prisma.user.findUnique({ where: { email: newEmail } });
      if (conflict && conflict.id !== userId) {
        return res.status(400).json({ ok: false, message: 'Email already in use' });
      }
    }

    // If email changed, mark unverified and send verification email
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { email: newEmail, ...(current?.email !== newEmail ? { emailVerified: false } : {}) },
      select: { id: true, email: true, fullName: true, phone: true, role: true, emailVerified: true }
    });

    if (newEmail && current?.email !== newEmail) {
      // Create token and send verification
      const { createEmailVerification } = await import('../services/emailVerificationService');
      const { sendVerificationEmail } = await import('../services/emailService');
      try {
        const token = await createEmailVerification(userId, newEmail);
        await sendVerificationEmail(newEmail, token, updated.fullName ?? undefined);
      } catch (err) {
        console.error('[customerController] error sending verification email:', (err as Error).message);
      }
    }

    res.json({ ok: true, data: updated });
  },

  // POST /customer/profile/send-email-verification — resend verification for current user
  sendEmailVerification: async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.email) return res.status(400).json({ ok: false, message: 'No email configured' });
    if (user.emailVerified) return res.json({ ok: true, message: 'Email already verified' });

    const { createEmailVerification } = await import('../services/emailVerificationService');
    const { sendVerificationEmail } = await import('../services/emailService');
    try {
      const token = await createEmailVerification(userId, user.email);
      await sendVerificationEmail(user.email, token, user.fullName ?? undefined);
      res.json({ ok: true, message: 'Verification email sent' });
    } catch (err) {
      console.error('[customerController] resend error:', (err as Error).message);
      res.status(500).json({ ok: false, message: 'Could not send verification email' });
    }
  },

  // POST /customer/profile/verify-email — verify token (public)
  verifyEmail: async (req: Request, res: Response) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ ok: false, message: 'Missing token' });
    const { verifyEmailToken } = await import('../services/emailVerificationService');
    const result = await verifyEmailToken(token);
    if (!result.ok) return res.status(400).json({ ok: false, message: result.reason });
    if (result.userId === undefined) return res.status(400).json({ ok: false, message: 'Invalid token' });

    // Return updated user data so frontend can update UI immediately
    const user = await prisma.user.findUnique({
      where: { id: result.userId },
      select: { id: true, email: true, emailVerified: true, fullName: true, phone: true, role: true }
    });

    res.json({ ok: true, message: 'Email verified', user });
  },

  getNotifications: async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const notifications = await prisma.notification.findMany({
      where: { userId, read: false },
      orderBy: { createdAt: 'desc' },
      take: 30
    });
    // Read-state is now persisted via PATCH /customer/notifications/:id/read — we no
    // longer mark-read-on-fetch (that made clicked notifications reappear as unread).
    res.json({ ok: true, data: notifications });
  },

  // PATCH /customer/notifications/:id/read — mark one of the caller's notifications read
  markNotificationRead: async (req: Request, res: Response) => {
    const userId = req.user!.id;
    await prisma.notification.updateMany({
      where: { id: Number(req.params.id), userId },
      data: { read: true },
    });
    res.json({ ok: true });
  },

  // PATCH /customer/notifications/read-all — mark all the caller's unread notifications read
  markAllNotificationsRead: async (req: Request, res: Response) => {
    const userId = req.user!.id;
    await prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
    res.json({ ok: true });
  },

  // Diagnostic: list active channels and subscriber counts (no auth needed in dev)
  channelStats: (_req: Request, res: Response) => {
    res.json({ ok: true, data: channelManager.stats() });
  },

  getAvailableCPs: async (_req: Request, res: Response) => {
    const cps = await prisma.user.findMany({
      where: { role: 'CP' },
      select: { id: true, fullName: true, phone: true, email: true, preferredCity: true },
      orderBy: { fullName: 'asc' },
    });
    res.json({ ok: true, data: cps });
  },
};