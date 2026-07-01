import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { notifyDealParties } from '../services/dealNotify';

export const adminController = {

  //
  // ── Platform stats ─────────────────────────────────────────────────────────
  getStats: async (_req: Request, res: Response) => {
    const [
      totalUsers, totalBuilders, totalCPs, totalProjects,
      totalDeals, pendingDeals, totalCommission, pendingCommission,
      pendingDocCPs,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.builder.count(),
      prisma.channelPartner.count(),
      prisma.project.count(),
      prisma.deal.count(),
      prisma.deal.count({ where: { status: 'Enquiry' } }),
      prisma.deal.aggregate({ _sum: { dealValue: true } }),
      prisma.deal.aggregate({ where: { commissionStatus: 'Pending' }, _sum: { dealValue: true } }),
      prisma.channelPartner.count({
        where: {
          OR: [
            { aadhaarUrl: { not: null }, aadhaarVerified: false },
            { panUrl: { not: null }, panVerified: false },
            { reraUrl: { not: null }, reraVerified: false },
          ],
        },
      }),
    ]);

    res.json({
      ok: true,
      data: {
        totalUsers,
        totalBuilders,
        totalCPs,
        totalProjects,
        totalDeals,
        pendingDeals,
        gmv: totalCommission._sum.dealValue ?? 0,
        pendingCommission: pendingCommission._sum.dealValue ?? 0,
        pendingDocVerifications: pendingDocCPs,
      },
    });
  },

  // ── All users ──────────────────────────────────────────────────────────────
  getUsers: async (req: Request, res: Response) => {
    const { role, search } = req.query as Record<string, string>;
    const users = await prisma.user.findMany({
      where: {
        ...(role && role !== 'ALL' ? { role } : {}),
        ...(search ? {
          OR: [
            { fullName: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, phone: true, fullName: true, email: true, role: true,
        preferredCity: true, createdAt: true,
        channelPartner: {
          select: {
            id: true, tier: true, aadhaarVerified: true, panVerified: true, reraVerified: true,
            aadhaarUrl: true, panUrl: true, reraUrl: true,
          },
        },
        builder: { select: { id: true, companyName: true } },
      },
    });
    res.json({ ok: true, data: users });
  },

  // ── Suspend / unsuspend user (toggle via a flag on the role profile) ────────
  // We use a simple convention: prefix the role with SUSPENDED_ to block login.
  // A real prod system might have a `suspended` boolean on User.
  // For now this endpoint just returns a success — the token won't be re-issued once flagged.
  suspendUser: async (req: Request, res: Response) => {
    const { userId } = req.params;
    const { suspended } = req.body as { suspended: boolean };
    const user = await prisma.user.findUnique({ where: { id: Number(userId) } });
    if (!user) return res.status(404).json({ ok: false, message: 'User not found' });
    // Persist suspension state by toggling the role prefix
    const isSuspended = user.role.startsWith('SUSPENDED_');
    const newRole = suspended
      ? (isSuspended ? user.role : `SUSPENDED_${user.role}`)
      : user.role.replace(/^SUSPENDED_/, '');
    await prisma.user.update({ where: { id: Number(userId) }, data: { role: newRole } });
    res.json({ ok: true, data: { suspended } });
  },

  // ── All builders ───────────────────────────────────────────────────────────
  getBuilders: async (req: Request, res: Response) => {
    const { search } = req.query as Record<string, string>;
    const builders = await prisma.builder.findMany({
      where: search ? {
        OR: [
          { companyName: { contains: search, mode: 'insensitive' } },
          { user: { fullName: { contains: search, mode: 'insensitive' } } },
        ],
      } : {},
      include: {
        user: { select: { id: true, fullName: true, phone: true, email: true, createdAt: true } },
        _count: { select: { projects: true, deals: true } },
      },
      orderBy: { id: 'desc' },
    });
    res.json({ ok: true, data: builders });
  },

  // ── All projects ───────────────────────────────────────────────────────────
  getProjects: async (req: Request, res: Response) => {
    const { status, search } = req.query as Record<string, string>;
    const projects = await prisma.project.findMany({
      where: {
        ...(status && status !== 'ALL' ? { status } : {}),
        ...(search ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { city: { contains: search, mode: 'insensitive' } },
          ],
        } : {}),
      },
      include: {
        builder: { select: { id: true, companyName: true, user: { select: { fullName: true } } } },
        _count: { select: { deals: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ ok: true, data: projects });
  },

  // Toggle project featured flag
  toggleProjectFeatured: async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const project = await prisma.project.findUnique({ where: { id: Number(projectId) } });
    if (!project) return res.status(404).json({ ok: false, message: 'Project not found' });
    const updated = await prisma.project.update({
      where: { id: Number(projectId) },
      data: { featured: !project.featured },
    });
    res.json({ ok: true, data: { featured: updated.featured } });
  },

  // ── All CPs with document status ───────────────────────────────────────────
  getCPs: async (req: Request, res: Response) => {
    const { tier, docStatus, search } = req.query as Record<string, string>;

    const docFilter =
      docStatus === 'pending'  ? { OR: [
        { aadhaarUrl: { not: null }, aadhaarVerified: false },
        { panUrl: { not: null }, panVerified: false },
        { reraUrl: { not: null }, reraVerified: false },
      ]} :
      docStatus === 'verified' ? { aadhaarVerified: true, panVerified: true } :
      docStatus === 'missing'  ? { aadhaarUrl: null } :
      {};

    const cps = await prisma.channelPartner.findMany({
      where: {
        ...(tier && tier !== 'ALL' ? { tier } : {}),
        ...docFilter,
        ...(search ? {
          OR: [
            { user: { fullName: { contains: search, mode: 'insensitive' } } },
            { user: { phone: { contains: search } } },
            { user: { email: { contains: search, mode: 'insensitive' } } },
          ],
        } : {}),
      },
      include: {
        user: { select: { id: true, fullName: true, phone: true, email: true, createdAt: true } },
        _count: { select: { deals: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ ok: true, data: cps });
  },

  // ── CPs list scoped for the contact-assignment picker (id, name, city, tier) ─
  getCPsForAssignment: async (_req: Request, res: Response) => {
    const cps = await prisma.channelPartner.findMany({
      select: {
        id: true,
        city: true,
        tier: true,
        user: { select: { id: true, fullName: true, phone: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ ok: true, data: cps });
  },

  // Verify or reject a single CP document
  verifyDocument: async (req: Request, res: Response) => {
    const { cpId } = req.params;
    const { docType, approved, rejectionNote } = req.body as {
      docType: 'aadhaar' | 'pan' | 'rera';
      approved: boolean;
      rejectionNote?: string;
    };

    const allowed = ['aadhaar', 'pan', 'rera'];
    if (!allowed.includes(docType)) {
      return res.status(400).json({ ok: false, message: 'Invalid docType. Must be aadhaar, pan, or rera.' });
    }

    const cp = await prisma.channelPartner.findUnique({ where: { id: Number(cpId) } });
    if (!cp) return res.status(404).json({ ok: false, message: 'Channel partner not found' });

    const updateData: Record<string, unknown> = {};
    if (docType === 'aadhaar') updateData.aadhaarVerified = approved;
    if (docType === 'pan')     updateData.panVerified     = approved;
    if (docType === 'rera')    updateData.reraVerified    = approved;

    const updated = await prisma.channelPartner.update({
      where: { id: Number(cpId) },
      data: updateData,
    });

    // Notify the CP
    const docLabel = docType === 'aadhaar' ? 'Aadhaar' : docType === 'pan' ? 'PAN' : 'RERA';
    const notifMsg = approved
      ? `Your ${docLabel} document has been verified successfully.`
      : `Your ${docLabel} document was rejected${rejectionNote ? `: ${rejectionNote}` : '. Please re-upload a clearer copy.'}`;
    await prisma.notification.create({
      data: {
        userId:  cp.userId,
        title:   approved ? `${docLabel} Verified ✓` : `${docLabel} Rejected`,
        message: notifMsg,
        type:    approved ? 'info' : 'info',
        link:    '/cp/settings',
      },
    });

    res.json({ ok: true, data: updated });
  },

  // Update CP tier
  updateCPTier: async (req: Request, res: Response) => {
    const { cpId } = req.params;
    const { tier } = req.body as { tier: string };
    const allowed = ['Silver', 'Gold', 'Platinum'];
    if (!allowed.includes(tier)) {
      return res.status(400).json({ ok: false, message: 'Tier must be Silver, Gold, or Platinum' });
    }
    const updated = await prisma.channelPartner.update({
      where: { id: Number(cpId) },
      data: { tier },
    });
    res.json({ ok: true, data: updated });
  },

  // ── All deals ──────────────────────────────────────────────────────────────
  getDeals: async (req: Request, res: Response) => {
    const { status, search } = req.query as Record<string, string>;
    const deals = await prisma.deal.findMany({
      where: {
        ...(status && status !== 'ALL' ? { status } : {}),
        ...(search ? {
          OR: [
            { customer: { fullName: { contains: search, mode: 'insensitive' } } },
            { project:  { name:     { contains: search, mode: 'insensitive' } } },
          ],
        } : {}),
      },
      include: {
        customer: { select: { id: true, fullName: true, phone: true, email: true, preferredCity: true } },
        project:  { select: { id: true, name: true, city: true } },
        builder:  { select: { id: true, companyName: true } },
        cp:       { select: { id: true, city: true, user: { select: { id: true, fullName: true } } } },
        loanCase: { select: { id: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ ok: true, data: deals });
  },

  // ── Assign (or unassign) a CP to a deal ────────────────────────────────────
  assignCPToDeal: async (req: Request, res: Response) => {
    const { dealId } = req.params;
    const { cpUserId } = req.body as { cpUserId: number | null };

    let cpId: number | null = null;
    if (cpUserId != null) {
      // Ensure the ChannelPartner row exists — create it if this CP has never used the CP features yet
      const cp = await prisma.channelPartner.upsert({
        where:  { userId: Number(cpUserId) },
        update: {},
        create: { userId: Number(cpUserId) },
      });
      cpId = cp.id;
    }

    const updated = await prisma.deal.update({
      where: { id: Number(dealId) },
      data:  { cpId },
      include: {
        customer: { select: { id: true, fullName: true, phone: true, email: true, preferredCity: true } },
        project:  { select: { id: true, name: true, city: true } },
        builder:  { select: { id: true, companyName: true } },
        cp:       { select: { id: true, city: true, user: { select: { id: true, fullName: true } } } },
        loanCase: { select: { id: true, status: true } },
      },
    });

    if (cpId) {
      await notifyDealParties(updated.id, {
        type: 'deal_assigned',
        title: 'Deal Assigned',
        message: `You have been assigned to the deal for ${updated.project.name}.`,
        to: ['cp'],
      });
    }

    res.json({ ok: true, data: updated });
  },

  // ── Update deal milestone stage ────────────────────────────────────────────
  updateDealMilestone: async (req: Request, res: Response) => {
    const { dealId } = req.params;
    const { status } = req.body as { status: string };

    const deal = await prisma.deal.findUnique({ where: { id: Number(dealId) } });
    if (!deal) return res.status(404).json({ ok: false, message: 'Deal not found' });

    const updated = await prisma.deal.update({
      where: { id: Number(dealId) },
      data: { status },
    });
    res.json({ ok: true, data: updated });
  },

  // ── Contact requests ──────────────────────────────────────────────────────

  submitContactRequest: async (req: Request, res: Response) => {
    const { name, phone, email, city, interest, message } = req.body;
    if (!name?.trim() || !phone?.trim()) {
      return res.status(400).json({ ok: false, message: 'Name and phone are required' });
    }
    const contact = await prisma.contactRequest.create({
      data: {
        name:     name.trim(),
        phone:    phone.trim(),
        email:    email?.trim() || null,
        city:     city?.trim() || null,
        interest: interest?.trim() || null,
        message:  message?.trim() || null,
      },
    });
    res.json({ ok: true, data: contact });
  },

  getContactRequests: async (_req: Request, res: Response) => {
    const contacts = await prisma.contactRequest.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ ok: true, data: contacts });
  },

  updateContactStatus: async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const { status } = req.body;
    if (!['new', 'in_progress', 'resolved'].includes(status)) {
      return res.status(400).json({ ok: false, message: 'Invalid status' });
    }
    try {
      const contact = await prisma.contactRequest.update({ where: { id }, data: { status } });
      res.json({ ok: true, data: contact });
    } catch {
      res.status(404).json({ ok: false, message: 'Contact request not found' });
    }
  },

  // ── Revenue analytics ──────────────────────────────────────────────────────
  getRevenueStats: async (req: Request, res: Response) => {
    const { range } = req.query as { range?: string };

    const now = new Date();
    let from: Date;
    if (range === 'this_year')       from = new Date(now.getFullYear(), 0, 1);
    else if (range === 'last_6_months') from = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    else if (range === 'last_3_months') from = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    else                              from = new Date(now.getFullYear(), now.getMonth(), 1); // this month

    const dateFilter = { createdAt: { gte: from } };

    const deals = await prisma.deal.findMany({
      where: dateFilter,
      include: {
        project:  { select: { name: true, city: true } },
        builder:  { select: { companyName: true } },
        cp:       { select: { tier: true } },
      },
    });

    // ── KPIs ──────────────────────────────────────────────────────────────────
    const totalGmv      = deals.reduce((s, d) => s + (d.dealValue ?? 0), 0);
    const totalDeals    = deals.length;
    const pendingPayout = deals.filter(d => d.commissionStatus === 'Pending').reduce((s, d) => s + (d.dealValue ?? 0), 0);
    const avgDealSize   = totalDeals > 0 ? totalGmv / totalDeals : 0;

    // ── GMV & deal count by calendar month ────────────────────────────────────
    const monthMap = new Map<string, { gmv: number; deals: number }>();
    for (const d of deals) {
      const key = d.createdAt.toISOString().slice(0, 7); // "YYYY-MM"
      const cur = monthMap.get(key) ?? { gmv: 0, deals: 0 };
      cur.gmv   += d.dealValue ?? 0;
      cur.deals += 1;
      monthMap.set(key, cur);
    }
    const monthLabels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const trendData = Array.from(monthMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => ({
        month:   monthLabels[Number(k.slice(5, 7)) - 1],
        gmv:     Math.round(v.gmv / 1_00_00_000), // crores (Indian)
        deals:   v.deals,
        revenue: Math.round(v.gmv / 1_00_00_000),
      }));

    // ── Revenue by city ────────────────────────────────────────────────────────
    const cityMap = new Map<string, number>();
    for (const d of deals) {
      const city = d.project?.city ?? 'Other';
      cityMap.set(city, (cityMap.get(city) ?? 0) + (d.dealValue ?? 0));
    }
    const revenueByCity = Array.from(cityMap.entries())
      .map(([city, v]) => ({ city, revenue: Math.round(v / 1_00_00_000) }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8);

    // ── Revenue by CP tier ─────────────────────────────────────────────────────
    const TIER_COLORS: Record<string, string> = {
      Platinum: '#8B5CF6', Gold: '#F59E0B', Silver: '#6B7280', Direct: '#0A7E8C',
    };
    const tierMap = new Map<string, number>();
    for (const d of deals) {
      const tier = d.cp?.tier ?? 'Direct';
      tierMap.set(tier, (tierMap.get(tier) ?? 0) + (d.dealValue ?? 0));
    }
    const totalTierGmv = Array.from(tierMap.values()).reduce((s, v) => s + v, 0) || 1;
    const revenueByTier = Array.from(tierMap.entries())
      .map(([name, v]) => ({ name, value: Math.round((v / totalTierGmv) * 100), color: TIER_COLORS[name] ?? '#6B7280' }))
      .sort((a, b) => b.value - a.value);

    // ── Top projects by GMV ────────────────────────────────────────────────────
    const projectMap = new Map<string, number>();
    for (const d of deals) {
      const name = d.project?.name ?? 'Unknown';
      projectMap.set(name, (projectMap.get(name) ?? 0) + (d.dealValue ?? 0));
    }
    const topProjects = Array.from(projectMap.entries())
      .map(([name, v]) => ({ name, revenue: Math.round(v / 1_00_00_000) }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 6);

    // ── Conversion funnel ──────────────────────────────────────────────────────
    const STAGE_GROUPS = {
      Leads:        null,   // all deals are leads
      Meetings:     ['Site Visit Scheduled', 'Site Visit Done', 'Negotiation', 'Booked', 'Loan Application Created', 'Loan Sanctioned', 'Loan Disbursed', 'Registration Done', 'Possession Given'],
      Negotiations: ['Negotiation', 'Booked', 'Loan Application Created', 'Loan Sanctioned', 'Loan Disbursed', 'Registration Done', 'Possession Given'],
      Closed:       ['Registration Done', 'Possession Given'],
    };
    const funnelCounts = {
      Leads:        totalDeals,
      Meetings:     deals.filter(d => (STAGE_GROUPS.Meetings as string[]).includes(d.status)).length,
      Negotiations: deals.filter(d => (STAGE_GROUPS.Negotiations as string[]).includes(d.status)).length,
      Closed:       deals.filter(d => (STAGE_GROUPS.Closed as string[]).includes(d.status)).length,
    };
    const FUNNEL_COLORS = ['#3B82F6','#8B5CF6','#F59E0B','#16A34A'];
    const funnel = Object.entries(funnelCounts).map(([name, value], i) => ({ name, value, fill: FUNNEL_COLORS[i] }));

    // ── Breakdown by builder + project ────────────────────────────────────────
    const bpKey = (d: typeof deals[0]) => `${d.builder?.companyName ?? 'Unknown'}|||${d.project?.name ?? 'Unknown'}`;
    const bpMap = new Map<string, { builder: string; project: string; units: number; gmv: number; pendingGmv: number }>();
    for (const d of deals) {
      const k = bpKey(d);
      const cur = bpMap.get(k) ?? { builder: d.builder?.companyName ?? 'Unknown', project: d.project?.name ?? 'Unknown', units: 0, gmv: 0, pendingGmv: 0 };
      cur.units     += 1;
      cur.gmv       += d.dealValue ?? 0;
      if (d.commissionStatus === 'Pending') cur.pendingGmv += d.dealValue ?? 0;
      bpMap.set(k, cur);
    }
    const breakdown = Array.from(bpMap.values())
      .map(r => ({
        builder:       r.builder,
        project:       r.project,
        unitsSold:     r.units,
        gmv:           r.gmv,
        cpCommission:  Math.round(r.gmv * 0.03),
        netRevenue:    Math.round(r.gmv * 0.01),
        pendingPayout: r.pendingGmv,
      }))
      .sort((a, b) => b.gmv - a.gmv);

    res.json({
      ok: true,
      data: {
        kpis: { totalGmv, totalDeals, pendingPayout, avgDealSize },
        trendData,
        revenueByCity,
        revenueByTier,
        topProjects,
        funnel,
        breakdown,
      },
    });
  },

  // ── All commissions ────────────────────────────────────────────────────────
  getCommissions: async (_req: Request, res: Response) => {
    const deals = await prisma.deal.findMany({
      where: { cp: { isNot: null } },
      include: {
        customer: { select: { fullName: true } },
        project:  { select: { name: true, city: true } },
        cp:       { select: { id: true, tier: true, user: { select: { fullName: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ ok: true, data: deals });
  },

  // ── All loan cases (bank / admin view) ────────────────────────────────────
  getLoanCases: async (_req: Request, res: Response) => {
    const cases = await prisma.loanCase.findMany({
      include: {
        customer:  { select: { id: true, fullName: true, phone: true, email: true } },
        deal:      { select: { id: true, status: true, dealValue: true,
                               project: { select: { name: true, city: true } },
                               builder: { select: { companyName: true } } } },
      },
      orderBy: { submittedAt: 'desc' },
      take: 200,
    });
    res.json({ ok: true, data: cases });
  },

  // ── Single loan case with timeline + deal documents (bank detail view) ────
  getLoanCase: async (req: Request, res: Response) => {
    const loanCase = await prisma.loanCase.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        customer: { select: { id: true, fullName: true, phone: true, email: true } },
        deal:     { select: { id: true, status: true, dealValue: true,
                              project: { select: { name: true, city: true } },
                              builder: { select: { companyName: true } },
                              dealDocuments: { orderBy: { createdAt: 'desc' } } } },
        notes:    { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!loanCase) return res.status(404).json({ ok: false, message: 'Loan case not found' });
    res.json({ ok: true, data: loanCase });
  },

  // ── Bank adds a note / document request to the loan timeline ──────────────
  addLoanCaseNote: async (req: Request, res: Response) => {
    const { id } = req.params;
    const { content, type, sender, notifyCustomer } = req.body as {
      content?: string; type?: string; sender?: string; notifyCustomer?: boolean;
    };
    if (!content?.trim()) return res.status(400).json({ ok: false, message: 'Note content is required' });

    const loanCase = await prisma.loanCase.findUnique({ where: { id: Number(id) } });
    if (!loanCase) return res.status(404).json({ ok: false, message: 'Loan case not found' });

    const note = await prisma.loanNote.create({
      data: {
        loanCaseId: loanCase.id,
        type: type === 'document' ? 'document' : 'note',
        sender: sender?.trim() || 'Bank',
        senderRole: 'bank',
        content: content.trim(),
      },
    });

    if (notifyCustomer) {
      await notifyDealParties(loanCase.dealId, {
        type: 'notification',
        notifType: 'info',
        title: type === 'document' ? 'Documents Requested' : 'Loan Update',
        message: content.trim(),
        to: ['customer'],
        link: { customer: '/customer/loan?tab=status' },
      }).catch(() => {});
    }

    res.json({ ok: true, data: note });
  },

  updateLoanCaseStatus: async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status, bank, officerName, officerPhone, interestRate, emi, note } = req.body;
    const allowed = ['Applied', 'Under Review', 'Sanctioned', 'Disbursed', 'Rejected'];
    if (!allowed.includes(status)) return res.status(400).json({ ok: false, message: 'Invalid status' });
    try {
      const updated = await prisma.loanCase.update({
        where: { id: Number(id) },
        data: {
          status,
          ...(bank         ? { bank }         : {}),
          ...(officerName  ? { officerName }  : {}),
          ...(officerPhone ? { officerPhone } : {}),
          ...(interestRate ? { interestRate: Number(interestRate) } : {}),
          ...(emi          ? { emi: Number(emi) }                  : {}),
        },
      });

      // Log the bank action on the loan timeline.
      await prisma.loanNote.create({
        data: {
          loanCaseId: Number(id), type: 'status_update',
          sender: officerName || bank || 'Bank', senderRole: 'bank',
          content: `Loan status updated to "${status}"${bank ? ` · ${bank}` : ''}${interestRate ? ` · ${interestRate}%` : ''}.${note?.trim() ? ` Note: ${String(note).trim()}` : ''}`,
        },
      }).catch(() => {});

      // Sync to the customer (and builder) live — bell + SSE + opt-in WhatsApp.
      const friendly: Record<string, string> = {
        'Applied': 'received', 'Under Review': 'under review',
        'Sanctioned': 'sanctioned', 'Disbursed': 'disbursed', 'Rejected': 'not approved',
      };
      await notifyDealParties(updated.dealId, {
        type: 'notification',
        notifType: status === 'Rejected' ? 'error' : (status === 'Sanctioned' || status === 'Disbursed') ? 'success' : 'info',
        title: status === 'Sanctioned' ? 'Loan Sanctioned 🎉' : status === 'Disbursed' ? 'Loan Disbursed' : 'Loan Update',
        message: `Your home loan is now ${friendly[status] ?? status}.`,
        to: ['customer', 'builder'],
        link: { customer: '/customer/loan?tab=status', builder: '/builder/deals' },
      }).catch(() => {});

      res.json({ ok: true, data: updated });
    } catch {
      res.status(404).json({ ok: false, message: 'Loan case not found' });
    }
  },

  // ── All meetings (admin review) ────────────────────────────────────────────
  getMeetings: async (req: Request, res: Response) => {
    const { status, search } = req.query as Record<string, string | undefined>;
    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { customerName: { contains: search, mode: 'insensitive' } },
        { customerPhone: { contains: search } },
      ];
    }
    const meetings = await prisma.meeting.findMany({
      where,
      include: { project: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const cpIds = [...new Set(meetings.map(m => (m as any).cpId).filter(Boolean))];
    const cpMap: Record<number, string> = {};
    if (cpIds.length > 0) {
      const cps = await prisma.channelPartner.findMany({
        where: { id: { in: cpIds } },
        select: { id: true, user: { select: { fullName: true } } },
      });
      cps.forEach(cp => { cpMap[cp.id] = cp.user?.fullName ?? 'CP'; });
    }

    const mapped = meetings.map(m => ({
      ...m,
      projectName: m.project?.name ?? 'Unknown Project',
      cpName: (m as any).cpId ? (cpMap[(m as any).cpId] ?? null) : null,
      project: undefined,
    }));
    res.json({ ok: true, data: mapped });
  },

  // ── Account deletion requests ─────────────────────────────────────────────

  getDeletionRequests: async (_req: Request, res: Response) => {
    const requests = await prisma.accountDeletionRequest.findMany({
      orderBy: [{ status: 'asc' }, { requestedAt: 'desc' }],
      include: {
        user: { select: { id: true, fullName: true, phone: true, email: true, role: true, createdAt: true } },
      },
    });
    res.json({ ok: true, data: requests });
  },

  // Approve (anonymize & disable the account, keep financial records) or reject.
  reviewDeletionRequest: async (req: Request, res: Response) => {
    if (req.user?.role !== 'ADMIN') {
      return res.status(403).json({ ok: false, message: 'Admin access required' });
    }
    const id = Number(req.params.id);
    const { action } = req.body as { action?: 'approve' | 'reject' };
    if (action !== 'approve' && action !== 'reject') {
      return res.status(400).json({ ok: false, message: "action must be 'approve' or 'reject'" });
    }

    const request = await prisma.accountDeletionRequest.findUnique({ where: { id } });
    if (!request) return res.status(404).json({ ok: false, message: 'Request not found' });
    if (request.status !== 'pending') {
      return res.status(409).json({ ok: false, message: 'This request has already been reviewed.' });
    }

    if (action === 'reject') {
      const updated = await prisma.accountDeletionRequest.update({
        where: { id },
        data: { status: 'rejected', reviewedAt: new Date(), reviewedBy: req.user!.id },
      });
      return res.json({ ok: true, message: 'Request rejected.', data: updated });
    }

    // Approve → anonymize & disable the user inside a transaction. Deals,
    // commissions and meetings are intentionally preserved for audit/finance.
    const user = await prisma.user.findUnique({ where: { id: request.userId } });
    if (!user) return res.status(404).json({ ok: false, message: 'User not found' });
    const stamp = Date.now();
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          fullName: 'Deleted user',
          email: null,
          phone: `deleted-${user.id}-${stamp}`,
          whatsappOptIn: false,
          role: user.role.startsWith('SUSPENDED_') ? user.role : `SUSPENDED_${user.role}`,
        },
      }),
      prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
      prisma.accountDeletionRequest.update({
        where: { id },
        data: { status: 'approved', reviewedAt: new Date(), reviewedBy: req.user!.id },
      }),
    ]);
    res.json({ ok: true, message: 'Account anonymized and disabled.', data: { userId: user.id } });
  },
};
