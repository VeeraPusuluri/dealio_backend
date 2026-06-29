import { Request, Response } from 'express';
import { randomBytes } from 'crypto';
import prisma from '../utils/prisma';
import { channelManager } from '../services/channelManager';
import { notifyDealParties } from '../services/dealNotify';
import { threadKey } from '../utils/thread';
import { assertCpMayDeal, assignCustomerToCp, CpAssignmentError } from '../services/cpAssignment';

// In-memory OTP store for phone verification (dev-only)
const phoneOtpStore: Record<string, { otp: string; expiresAt: number }> = {};

export const cpController = {
  // ── Contacts ──────────────────────────────────────────────────────────

  getContacts: async (req: Request, res: Response) => {
    const cpUserId = Number(req.params.cpUserId);
    const cp = await prisma.channelPartner.findUnique({ where: { userId: cpUserId } });
    if (!cp) return res.json({ ok: true, data: [] });

    const contacts = await prisma.cPContact.findMany({
      where: { cpId: cp.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ ok: true, data: contacts });
  },

  addContact: async (req: Request, res: Response) => {
    const cpUserId = Number(req.params.cpUserId);
    const { name, phone, email, notes, tags, bhkPreference } = req.body;

    if (!name?.trim() || !phone?.trim()) {
      return res.status(400).json({ ok: false, message: 'Name and phone are required' });
    }

    let cp = await prisma.channelPartner.findUnique({ where: { userId: cpUserId } });
    if (!cp) {
      cp = await prisma.channelPartner.create({ data: { userId: cpUserId } });
    }

    const contact = await prisma.cPContact.create({
      data: {
        cpId: cp.id,
        name: name.trim(),
        phone: phone.trim(),
        email: email?.trim() || null,
        notes: notes?.trim() || null,
        tags: tags?.trim() || null,
        bhkPreference: bhkPreference?.trim() || null,
      },
    });
    res.json({ ok: true, data: contact });
  },

  updateContact: async (req: Request, res: Response) => {
    const contactId = Number(req.params.contactId);
    const { name, phone, email, notes, tags, bhkPreference } = req.body;

    const contact = await prisma.cPContact.update({
      where: { id: contactId },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(phone !== undefined && { phone: phone.trim() }),
        ...(email !== undefined && { email: email?.trim() || null }),
        ...(notes !== undefined && { notes: notes?.trim() || null }),
        ...(tags !== undefined && { tags: tags?.trim() || null }),
        ...(bhkPreference !== undefined && { bhkPreference: bhkPreference?.trim() || null }),
      },
    });
    res.json({ ok: true, data: contact });
  },

  deleteContact: async (req: Request, res: Response) => {
    const contactId = Number(req.params.contactId);
    await prisma.cPContact.delete({ where: { id: contactId } });
    res.json({ ok: true });
  },

  // ── Profile ───────────────────────────────────────────────────────────

  getProfile: async (req: Request, res: Response) => {
    const cpUserId = Number(req.params.cpUserId);
    const user = await prisma.user.findUnique({
      where: { id: cpUserId },
      include: { channelPartner: true },
    });
    if (!user) return res.status(404).json({ ok: false, message: 'User not found' });

    res.json({
      ok: true,
      data: {
        id:       user.id,
        fullName: user.fullName,
        email:    user.email,
        phone:    user.phone,
        cp:       user.channelPartner,
      },
    });
  },

  updateProfile: async (req: Request, res: Response) => {
    const cpUserId = Number(req.params.cpUserId);
    const { fullName, email, city, bio, reraNumber } = req.body;

    try {
      if (fullName !== undefined || email !== undefined) {
        await prisma.user.update({
          where: { id: cpUserId },
          data: {
            ...(fullName !== undefined && { fullName: fullName?.trim() || null }),
            ...(email !== undefined && { email: email?.trim() || null }),
          },
        });
      }

      let cp = await prisma.channelPartner.findUnique({ where: { userId: cpUserId } });
      if (!cp) {
        cp = await prisma.channelPartner.create({
          data: { userId: cpUserId, city: city?.trim() || null, bio: bio?.trim() || null, reraNumber: reraNumber?.trim() || null },
        });
      } else {
        cp = await prisma.channelPartner.update({
          where: { userId: cpUserId },
          data: {
            ...(city !== undefined && { city: city?.trim() || null }),
            ...(bio !== undefined && { bio: bio?.trim() || null }),
            ...(reraNumber !== undefined && { reraNumber: reraNumber?.trim() || null }),
          },
        });
      }

      const user = await prisma.user.findUnique({ where: { id: cpUserId }, include: { channelPartner: true } });
      res.json({ ok: true, data: { id: user!.id, fullName: user!.fullName, email: user!.email, phone: user!.phone, cp: user!.channelPartner } });
    } catch (err: any) {
      if (err?.code === 'P2002') return res.status(400).json({ ok: false, message: 'Email already in use' });
      res.status(500).json({ ok: false, message: 'Failed to update profile' });
    }
  },

  // ── Phone verification ─────────────────────────────────────────────────

  sendPhoneOtp: async (req: Request, res: Response) => {
    const { phone } = req.body;
    if (!phone?.trim()) return res.status(400).json({ ok: false, message: 'Phone is required' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    phoneOtpStore[phone.trim()] = { otp, expiresAt: Date.now() + 10 * 60 * 1000 };
    console.log(`[CP Phone Verify] phone=${phone.trim()} OTP=${otp}`);
    res.json({ ok: true, data: { message: 'OTP sent to your phone' } });
  },

  verifyPhone: async (req: Request, res: Response) => {
    const cpUserId = Number(req.params.cpUserId);
    const { phone, otp } = req.body;

    const stored = phoneOtpStore[phone?.trim()];
    if (!stored || stored.otp !== otp?.trim() || Date.now() > stored.expiresAt) {
      return res.status(400).json({ ok: false, message: 'Invalid or expired OTP' });
    }
    delete phoneOtpStore[phone.trim()];

    let cp = await prisma.channelPartner.findUnique({ where: { userId: cpUserId } });
    if (!cp) cp = await prisma.channelPartner.create({ data: { userId: cpUserId, phoneVerified: true } });
    else cp = await prisma.channelPartner.update({ where: { userId: cpUserId }, data: { phoneVerified: true } });

    res.json({ ok: true, data: { phoneVerified: true } });
  },

  // ── SSE notification stream ───────────────────────────────────────────

  streamNotifications: async (req: Request, res: Response) => {
    const userId = req.user!.id;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const channelKey = `user:${userId}`;
    channelManager.subscribe(channelKey, userId, res);

    res.write(`data: ${JSON.stringify({
      type: 'connected', title: '', message: 'Notification stream connected',
      city: '', timestamp: new Date().toISOString(),
    })}\n\n`);

    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { clearInterval(heartbeat); }
    }, 25_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      channelManager.unsubscribe(channelKey, userId);
    });
  },

  // ── Fetch and drain unread notifications from DB ──────────────────────

  getNotifications: async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const notifications = await prisma.notification.findMany({
      where: { userId, read: false },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    // Read-state is now persisted via PATCH /cp/notifications/:id/read — we no longer
    // mark-read-on-fetch (that made clicked notifications reappear as unread).
    res.json({ ok: true, data: notifications });
  },

  // PATCH /:cpUserId/notifications/:id/read — mark one of the caller's notifications read
  markNotificationRead: async (req: Request, res: Response) => {
    const userId = req.user!.id;
    await prisma.notification.updateMany({
      where: { id: Number(req.params.id), userId },
      data: { read: true },
    });
    res.json({ ok: true });
  },

  // PATCH /:cpUserId/notifications/read-all — mark all the caller's unread notifications read
  markAllNotificationsRead: async (req: Request, res: Response) => {
    const userId = req.user!.id;
    await prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
    res.json({ ok: true });
  },

  // ── Meetings ──────────────────────────────────────────────────────────

  getCPMeetings: async (req: Request, res: Response) => {
    const cpUserId = Number(req.params.cpUserId);
    const cp = await prisma.channelPartner.findUnique({ where: { userId: cpUserId } });
    if (!cp) return res.json({ ok: true, data: [] });

    const meetings = await prisma.meeting.findMany({
      where: { cpId: cp.id },
      include: { project: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      ok: true,
      data: meetings.map(m => ({ ...m, projectName: m.project?.name ?? 'Unknown Project', project: undefined })),
    });
  },

  addMeetingNote: async (req: Request, res: Response) => {
    const meetingId = Number(req.params.meetingId);
    const { notes, cpRating } = req.body;

    try {
      const meeting = await prisma.meeting.update({
        where: { id: meetingId },
        data: {
          cpNotes: notes ?? null,
          ...(cpRating !== undefined ? { cpRating: cpRating ? Number(cpRating) : null } : {}),
        },
        include: { project: { select: { name: true } } },
      });
      res.json({
        ok: true,
        data: { ...meeting, projectName: meeting.project?.name ?? 'Unknown Project', project: undefined },
      });
    } catch {
      res.status(404).json({ ok: false, message: 'Meeting not found' });
    }
  },

  // ── Document upload ────────────────────────────────────────────────────

  uploadDocument: async (req: Request, res: Response) => {
    const cpUserId = Number(req.params.cpUserId);
    const { docType } = req.body;
    if (!req.file) return res.status(400).json({ ok: false, message: 'No file uploaded' });

    const validDocTypes = ['aadhaar', 'pan', 'rera'];
    if (!validDocTypes.includes(docType)) {
      return res.status(400).json({ ok: false, message: 'docType must be aadhaar, pan, or rera' });
    }

    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/cp-docs/${req.file.filename}`;
    const updateData: Record<string, string | boolean> = {};
    if (docType === 'aadhaar') { updateData.aadhaarUrl = fileUrl; updateData.aadhaarVerified = false; }
    if (docType === 'pan')     { updateData.panUrl = fileUrl;     updateData.panVerified = false; }
    if (docType === 'rera')    { updateData.reraUrl = fileUrl;    updateData.reraVerified = false; }

    let cp = await prisma.channelPartner.findUnique({ where: { userId: cpUserId } });
    if (!cp) cp = await prisma.channelPartner.create({ data: { userId: cpUserId, ...updateData } });
    else cp = await prisma.channelPartner.update({ where: { userId: cpUserId }, data: updateData });

    res.json({ ok: true, data: { url: fileUrl, docType, cp } });
  },

  // ── CP Leads (deals where this CP was the referrer) ───────────────────

  getCPLeads: async (req: Request, res: Response) => {
    const cpUserId = Number(req.params.cpUserId);
    const cp = await prisma.channelPartner.upsert({
      where:  { userId: cpUserId },
      update: {},
      create: { userId: cpUserId },
    });

    const deals = await prisma.deal.findMany({
      where: { cpId: cp.id },
      include: {
        project:  { select: { name: true, commissionValue: true, builderId: true, builder: { select: { companyName: true, user: { select: { fullName: true } } } } } },
        customer: { select: { fullName: true, phone: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const leads = deals.map(d => ({
      id:                  d.id,
      projectId:           d.projectId,
      projectName:         d.project?.name ?? 'Unknown',
      builderId:           d.project?.builderId ?? null,
      builderName:         (d.project as any)?.builder?.companyName ?? (d.project as any)?.builder?.user?.fullName ?? 'Builder',
      customerName:        d.customer?.fullName ?? 'Unknown',
      customerPhone:       d.customer?.phone ?? '',
      customerEmail:       d.customer?.email ?? null,
      dealValue:           d.dealValue ?? null,
      status:              d.status,
      commissionStatus:    d.commissionStatus ?? 'Pending',
      commissionPercent:   d.project?.commissionValue ?? null,
      estimatedCommission:
        d.dealValue != null && d.project?.commissionValue != null
          ? (d.dealValue * d.project.commissionValue) / 100
          : null,
      createdAt:  d.createdAt.toISOString(),
      updatedAt:  d.updatedAt.toISOString(),
    }));

    res.json({ ok: true, data: leads });
  },

  // CP manually creates a new lead — always starts as 'New Lead'
  createCPLead: async (req: Request, res: Response) => {
    const cpUserId = Number(req.params.cpUserId);
    const { projectId, customerName, customerPhone, customerEmail } = req.body;

    if (!projectId || !customerPhone) {
      return res.status(400).json({ ok: false, message: 'projectId and customerPhone are required' });
    }

    const project = await prisma.project.findUnique({
      where: { id: Number(projectId) },
      include: { builder: { select: { id: true, userId: true } } },
    });
    if (!project) return res.status(404).json({ ok: false, message: 'Project not found' });

    let cp = await prisma.channelPartner.findUnique({ where: { userId: cpUserId } });
    if (!cp) cp = await prisma.channelPartner.create({ data: { userId: cpUserId } });

    let customer = await prisma.user.findUnique({ where: { phone: customerPhone } });
    if (!customer) {
      customer = await prisma.user.create({
        data: { phone: customerPhone, fullName: customerName?.trim() || customerPhone, role: 'CUSTOMER',
          ...(customerEmail ? { email: customerEmail.trim() } : {}) },
      });
    }

    // Enforce the 90-day CP↔customer lock: a different CP cannot deal this
    // customer on this project while another CP's assignment is active.
    try {
      await assertCpMayDeal(cp.id, customer.id, project.id);
    } catch (err) {
      if (err instanceof CpAssignmentError) {
        return res.status(err.status).json({ ok: false, message: err.message });
      }
      throw err;
    }

    const existingDeal = await prisma.deal.findFirst({
      where: { projectId: project.id, customerId: customer.id, builderId: project.builderId },
    });

    let deal;
    if (existingDeal) {
      deal = await prisma.deal.update({
        where: { id: existingDeal.id },
        data: { status: 'New Lead', cpId: cp.id },
      });
    } else {
      deal = await prisma.deal.create({
        data: {
          projectId:  project.id,
          builderId:  project.builderId,
          customerId: customer.id,
          cpId:       cp.id,
          status:     'New Lead',
        },
      });
    }

    // Lock this customer to this CP for this project for 90 days.
    await assignCustomerToCp(cp.id, customer.id, project.id);

    // Notify the builder
    if (project.builder?.userId) {
      const cpUser = await prisma.user.findUnique({ where: { id: cpUserId }, select: { fullName: true } });
      const title   = '🆕 New Lead Added by CP';
      const message = `${cpUser?.fullName ?? 'A CP'} added ${customer.fullName ?? customerPhone} as a new lead for "${project.name}".`;
      await prisma.notification.create({
        data: { userId: project.builder.userId, title, message, type: 'info', link: '/builder/leads' },
      });
      channelManager.publish(`user:${project.builder.userId}`, {
        type: 'new_lead', title, message, city: '', timestamp: new Date().toISOString(),
      });
    }

    res.json({ ok: true, data: { id: deal.id, status: deal.status } });
  },

  // ── Follow-ups ────────────────────────────────────────────────────────

  getDueToday: async (req: Request, res: Response) => {
    const cpUserId = Number(req.params.cpUserId);
    const cp = await prisma.channelPartner.findUnique({ where: { userId: cpUserId } });
    if (!cp) return res.json({ ok: true, data: { meetings: [], followUps: [], callLogs: [] } });

    const today = new Date().toISOString().slice(0, 10);
    // Normalise a stored date string to YYYY-MM-DD — same logic the follow-ups calendar uses.
    const dateOnly = (s?: string | null) => {
      if (!s) return '';
      const d = new Date(s);
      return isNaN(d.getTime()) ? s.split('T')[0] : d.toISOString().slice(0, 10);
    };

    const [followUps, callLogs, meetingRows] = await Promise.all([
      prisma.cPFollowUp.findMany({
        where: { cpId: cp.id, dueDate: today, done: false },
        include: {
          deal: {
            include: {
              customer: { select: { fullName: true } },
              project:  { select: { name: true } },
            },
          },
        },
        orderBy: { dueTime: 'asc' },
      }),
      prisma.cPCallLog.findMany({
        where: { cpId: cp.id, nextFollowUp: today },
        include: {
          deal: {
            include: {
              customer: { select: { fullName: true } },
              project:  { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.meeting.findMany({
        where: { cpId: cp.id, status: { not: 'Cancelled' } },
        include: { project: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    // Meetings scheduled for today (date-only of confirmed/preferred date), excluding
    // only cancelled — matching the follow-ups calendar. These were previously missing.
    const meetings = meetingRows
      .filter(m => dateOnly(m.confirmedDate ?? m.preferredDate) === today)
      .map(m => ({
        id:           String(m.id),
        customerName: m.customerName,
        projectName:  m.project?.name ?? 'Unknown Project',
        meetingType:  m.meetingType,
        time:         m.confirmedTime ?? m.preferredTime ?? null,
        status:       m.status,
      }));

    res.json({
      ok: true,
      data: {
        meetings,
        followUps: followUps.map(f => ({
          id:           String(f.id),
          dealId:       String(f.dealId),
          customerName: f.deal.customer?.fullName ?? 'Unknown',
          projectName:  f.deal.project?.name ?? 'Unknown',
          reason:       f.reason,
          dueDate:      f.dueDate,
          dueTime:      f.dueTime,
          done:         f.done,
        })),
        callLogs: callLogs.map(c => ({
          id:           String(c.id),
          dealId:       String(c.dealId),
          customerName: c.deal.customer?.fullName ?? 'Unknown',
          projectName:  c.deal.project?.name ?? 'Unknown',
          outcome:      c.outcome,
          nextFollowUp: c.nextFollowUp,
          notes:        c.notes,
          createdBy:    c.createdBy,
        })),
      },
    });
  },

  getFollowUps: async (req: Request, res: Response) => {
    const cpUserId = Number(req.params.cpUserId);
    const cp = await prisma.channelPartner.findUnique({ where: { userId: cpUserId } });
    if (!cp) return res.json({ ok: true, data: [] });

    const followUps = await prisma.cPFollowUp.findMany({
      where: { cpId: cp.id },
      include: {
        deal: {
          include: {
            customer: { select: { fullName: true } },
            project:  { select: { name: true } },
          },
        },
      },
      orderBy: { dueDate: 'asc' },
    });

    res.json({
      ok: true,
      data: followUps.map(f => ({
        id:           String(f.id),
        dealId:       String(f.dealId),
        customerName: f.deal.customer?.fullName ?? 'Unknown',
        projectName:  f.deal.project?.name ?? 'Unknown',
        reason:       f.reason,
        dueDate:      f.dueDate,
        dueTime:      f.dueTime,
        done:         f.done,
        createdAt:    f.createdAt.toISOString(),
      })),
    });
  },

  createFollowUp: async (req: Request, res: Response) => {
    const cpUserId = Number(req.params.cpUserId);
    const { dealId, dueDate, dueTime, reason } = req.body;

    if (!dealId || !dueDate || !reason) {
      return res.status(400).json({ ok: false, message: 'dealId, dueDate, and reason are required' });
    }

    let cp = await prisma.channelPartner.findUnique({ where: { userId: cpUserId } });
    if (!cp) cp = await prisma.channelPartner.create({ data: { userId: cpUserId } });

    const followUp = await prisma.cPFollowUp.create({
      data: {
        cpId:    cp.id,
        dealId:  Number(dealId),
        dueDate: String(dueDate),
        dueTime: dueTime ?? null,
        reason:  String(reason),
      },
    });

    res.json({ ok: true, data: { ...followUp, id: String(followUp.id) } });
  },

  markFollowUpDone: async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    try {
      const followUp = await prisma.cPFollowUp.update({ where: { id }, data: { done: true } });
      res.json({ ok: true, data: { ...followUp, id: String(followUp.id) } });
    } catch {
      res.status(404).json({ ok: false, message: 'Follow-up not found' });
    }
  },

  // ── Call logs ─────────────────────────────────────────────────────────

  getCallLogs: async (req: Request, res: Response) => {
    const cpUserId = Number(req.params.cpUserId);
    const cp = await prisma.channelPartner.findUnique({ where: { userId: cpUserId } });
    if (!cp) return res.json({ ok: true, data: [] });

    const callLogs = await prisma.cPCallLog.findMany({
      where: { cpId: cp.id },
      include: {
        deal: {
          include: {
            customer: { select: { fullName: true } },
            project:  { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      ok: true,
      data: callLogs.map(c => ({
        id:              String(c.id),
        dealId:          String(c.dealId),
        customerName:    c.deal.customer?.fullName ?? 'Unknown',
        projectName:     c.deal.project?.name ?? 'Unknown',
        outcome:         c.outcome,
        duration:        c.duration,
        notes:           c.notes,
        nextFollowUp:    c.nextFollowUp,
        nextFollowUpTime: c.nextFollowUpTime,
        createdAt:       c.createdAt.toISOString(),
        createdBy:       c.createdBy,
      })),
    });
  },

  createCallLog: async (req: Request, res: Response) => {
    const cpUserId = Number(req.params.cpUserId);
    const { dealId, outcome, duration, notes, nextFollowUp, nextFollowUpTime } = req.body;

    if (!dealId || !outcome || !duration) {
      return res.status(400).json({ ok: false, message: 'dealId, outcome, and duration are required' });
    }

    let cp = await prisma.channelPartner.findUnique({ where: { userId: cpUserId } });
    if (!cp) cp = await prisma.channelPartner.create({ data: { userId: cpUserId } });

    const cpUser = await prisma.user.findUnique({ where: { id: cpUserId }, select: { fullName: true } });

    const callLog = await prisma.cPCallLog.create({
      data: {
        cpId:            cp.id,
        dealId:          Number(dealId),
        outcome:         String(outcome),
        duration:        String(duration),
        notes:           notes ?? '',
        nextFollowUp:    nextFollowUp ?? null,
        nextFollowUpTime: nextFollowUpTime ?? null,
        createdBy:       cpUser?.fullName ?? 'CP',
      },
    });

    res.json({ ok: true, data: { ...callLog, id: String(callLog.id) } });
  },

  // ── Share links ────────────────────────────────────────────────────────

  getOrCreateShareLink: async (req: Request, res: Response) => {
    const cpUserId  = Number(req.params.cpUserId);
    const projectId = Number(req.params.projectId);

    let cp = await prisma.channelPartner.findUnique({ where: { userId: cpUserId } });
    if (!cp) cp = await prisma.channelPartner.create({ data: { userId: cpUserId } });

    // Find existing link for this CP + project
    let link = await prisma.projectShareLink.findFirst({
      where: { projectId, cpId: cp.id },
    });

    if (!link) {
      link = await prisma.projectShareLink.create({
        data: {
          token:     randomBytes(12).toString('hex'), // 24-char hex, URL-safe
          projectId,
          cpId:      cp.id,
        },
      });
    }

    const origin = process.env.FRONTEND_URL ?? 'http://localhost:8083';
    res.json({
      ok: true,
      data: {
        token:      link.token,
        url:        `${origin}/p/${link.token}`,
        clickCount: link.clickCount,
      },
    });
  },

  agreeDeal: async (req: Request, res: Response) => {
    const { cpUserId, dealId } = req.params;
    const cp = await prisma.channelPartner.findUnique({ where: { userId: Number(cpUserId) } });
    if (!cp) return res.status(404).json({ ok: false, message: 'CP not found' });
    try {
      const updated = await prisma.deal.update({
        where: { id: Number(dealId), cpId: cp.id },
        data:  { cpAgreed: true, status: 'Agreement' },
        include: {
          builder: { select: { userId: true } },
          project: { select: { name: true, commissionValue: true } },
        },
      });
      const tierRates: Record<string, number> = { Silver: 1.5, Gold: 2.0, Platinum: 2.5 };
      const commPct    = (updated.project as any)?.commissionValue > 0 ? (updated.project as any).commissionValue : (tierRates[cp.tier] ?? 1.5);
      const commAmount = updated.dealValue ? updated.dealValue * commPct / 100 : null;
      const agreeProject = (updated.project as any)?.name ?? 'your project';
      await notifyDealParties(updated.id, {
        type: 'deal_agreed',
        title: 'CP Agreed to Deal',
        message: `CP agreed to the deal for ${agreeProject}. Stage: Agreement.`,
        to: ['builder'],
        link: { builder: '/builder/deals' },
        whatsappTemplate: 'deal_stage_update',
        whatsappVars: ({ name }) => [name, agreeProject, 'Agreement'],
      }).catch(() => {});
      res.json({ ok: true, data: { id: updated.id, status: updated.status, commissionPercent: commPct, commissionAmount: commAmount } });
    } catch {
      res.status(404).json({ ok: false, message: 'Deal not found' });
    }
  },

  // POST /:cpUserId/deals/:dealId/messages — CP sends message to builder in deal thread
  sendCPDealMessage: async (req: Request, res: Response) => {
    const { cpUserId, dealId } = req.params;
    const { message } = req.body;
    // recipientRole picks the private thread: cp↔customer or cp↔builder. Defaults to
    // builder to preserve the legacy behaviour of older callers that omit it.
    const recipientRole: 'customer' | 'builder' = req.body.recipientRole === 'customer' ? 'customer' : 'builder';
    if (!message?.trim()) return res.status(400).json({ ok: false, message: 'message is required' });
    const cp = await prisma.channelPartner.findUnique({
      where: { userId: Number(cpUserId) },
      select: { id: true, user: { select: { fullName: true } } },
    });
    if (!cp) return res.status(404).json({ ok: false, message: 'CP not found' });
    const msg = await prisma.dealMessage.create({
      data: {
        dealId:     Number(dealId),
        senderId:   Number(cpUserId),
        senderName: (cp.user as any)?.fullName ?? 'CP',
        senderRole: 'cp',
        threadKey:  threadKey('cp', recipientRole),
        message,
      },
    });
    await notifyDealParties(Number(dealId), {
      type: 'deal_message',
      title: 'New message from CP',
      message: message.substring(0, 80),
      to: [recipientRole],
      link: { builder: '/builder/deals', customer: '/customer/conversations' },
      whatsappTemplate: 'deal_new_message',
    }).catch(() => {});
    res.json({ ok: true, data: msg });
  },

  // GET /:cpUserId/commissions — all deals this CP closed with commission breakdown
  getCommissions: async (req: Request, res: Response) => {
    const { cpUserId } = req.params;
    const cp = await prisma.channelPartner.findUnique({ where: { userId: Number(cpUserId) } });
    if (!cp) return res.json({ ok: true, data: [] });

    const tierRates: Record<string, number> = { Silver: 1.5, Gold: 2.0, Platinum: 2.5 };

    const deals = await prisma.deal.findMany({
      where: { cpId: cp.id },
      include: {
        customer: { select: { fullName: true, phone: true } },
        project:  { select: { name: true, city: true, commissionValue: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const result = deals.map(d => {
      const commPct    = (d.project as any)?.commissionValue > 0 ? (d.project as any).commissionValue : (tierRates[cp.tier] ?? 1.5);
      const commAmount = d.dealValue ? Math.round(d.dealValue * commPct / 100) : 0;
      return {
        id:                  d.id,
        status:              d.status,
        dealValue:           d.dealValue,
        commissionStatus:    d.commissionStatus,
        commissionPercent:   commPct,
        commissionAmount:    commAmount,
        commissionReleasedAt: d.commissionReleasedAt,
        createdAt:           d.createdAt,
        customerName:        (d.customer as any)?.fullName ?? 'Unknown',
        projectName:         (d.project as any)?.name ?? 'Unknown',
        projectCity:         (d.project as any)?.city ?? '',
        cpTier:              cp.tier,
      };
    });

    res.json({ ok: true, data: result });
  },

  // GET /:cpUserId/deals/:dealId — CP gets deal detail with docs + messages + commission
  getCPDeal: async (req: Request, res: Response) => {
    const { cpUserId, dealId } = req.params;
    const cp = await prisma.channelPartner.findUnique({ where: { userId: Number(cpUserId) } });
    if (!cp) return res.status(404).json({ ok: false, message: 'CP not found' });
    const deal = await prisma.deal.findUnique({
      where: { id: Number(dealId), cpId: cp.id },
      include: {
        customer: { select: { fullName: true, phone: true } },
        project:  { select: { name: true, commissionValue: true } },
        messages:      { orderBy: { createdAt: 'asc' } },
        dealDocuments: { where: { sharedWithCp: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!deal) return res.status(404).json({ ok: false, message: 'Deal not found' });
    const tierRates: Record<string, number> = { Silver: 1.5, Gold: 2.0, Platinum: 2.5 };
    const commPct    = (deal.project as any)?.commissionValue > 0 ? (deal.project as any).commissionValue : (tierRates[cp.tier] ?? 1.5);
    const commAmount = deal.dealValue ? deal.dealValue * commPct / 100 : null;
    res.json({ ok: true, data: {
      ...deal,
      customerName:  (deal.customer as any)?.fullName ?? 'Unknown',
      customerPhone: (deal.customer as any)?.phone ?? '',
      projectName:   (deal.project as any)?.name ?? 'Unknown',
      cpTier: cp.tier,
      commissionPercent: commPct,
      commissionAmount:  commAmount,
      customer: undefined, project: undefined,
    }});
  },
};