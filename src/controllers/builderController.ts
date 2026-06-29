import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { channelManager } from '../services/channelManager';
import { notifyDealParties } from '../services/dealNotify';
import { threadKey } from '../utils/thread';
import PDFDocument from 'pdfkit';
import { generateICS } from '../services/calendarService';
import { sendCalendarInvite } from '../services/emailService';
import { assignCustomerToCp } from '../services/cpAssignment';

const DEAL_STATUS_NORM: Record<string, string> = {
  'new lead': 'New Lead', 'profile created': 'Profile Created',
  'meeting requested': 'Meeting Requested', 'meeting confirmed': 'Meeting Confirmed',
  'meeting done': 'Meeting Done', 'negotiation': 'Negotiation',
  'agreement': 'Agreement', 'pending booking': 'Pending Booking', 'booked': 'Booked',
  'loan sanctioned': 'Loan Sanctioned', 'closed': 'Closed', 'possession': 'Possession',
};
function normalizeDealStatus(s: string): string {
  return DEAL_STATUS_NORM[s.toLowerCase().trim()] ?? s;
}

// Privacy: a builder must never see or call the customer's phone — only the
// channel partner brokers contact. These builder-facing controllers are mounted
// under both /api/builder (builder) and /api/portal (customer), so we mask only
// when the *requester* is a builder; customers/CPs still get the real number.
function isBuilderRequest(req: Request): boolean {
  return req.user?.role === 'BUILDER';
}
// Returns the customer phone for the requester, or '' for a builder.
function customerPhoneFor(req: Request, phone: string | null | undefined): string {
  return isBuilderRequest(req) ? '' : (phone ?? '');
}

// Maps DB column names (priceFrom/priceTo) to the frontend's expected names (priceMin/priceMax)
function toProjectDto(p: Record<string, unknown>, builder?: Record<string, unknown>) {
  const { priceFrom, priceTo, ...rest } = p;
  return {
    ...rest,
    priceMin: priceFrom ?? null,
    priceMax: priceTo ?? null,
    // Expose builder profile fields on the project DTO for the edit form
    builderName: builder?.companyName ?? null,
    builderAbout: builder?.about ?? null,
    builderYearEstablished: builder?.yearEstablished ?? null,
    builderDeliveredProjects: builder?.deliveredProjects ?? null,
    builderWebsite: builder?.website ?? null,
  };
}

export const builderController = {
  ensureBuilder: async (req: Request, res: Response) => {
    const { name, email, phone, userId } = req.body;
    
    let builder = await prisma.builder.findFirst({
      where: {
        OR: [
          { user: { email: email } },
          { userId: userId || -1 }
        ]
      },
      include: { user: true }
    });
    
    if (!builder) {
      // Create user first if not exists
      let user = await prisma.user.findFirst({
        where: {
          OR: [
            { email: email },
            { phone: phone }
          ]
        }
      });

      if (!user) {
        user = await prisma.user.create({
          data: {
            phone: phone || `temp-${Date.now()}`,
            fullName: name,
            email: email,
            role: 'BUILDER'
          }
        });
      }

      builder = await prisma.builder.findUnique({
        where: { userId: user.id },
        include: { user: true }
      });

      if (!builder) {
        builder = await prisma.builder.create({
          data: {
            userId: user.id
          },
          include: { user: true }
        });
      }
    }
    
    res.json({ ok: true, data: { builderId: builder.id } });
  },

  createProject: async (req: Request, res: Response) => {
    const { builderId } = req.params;
    const projectData = req.body;

    const newProject = await prisma.project.create({
      data: {
        builderId: Number(builderId),
        name: projectData.name,
        city: projectData.city,
        locality: projectData.locality || null,
        pincode: projectData.pincode || null,
        landmark: projectData.landmark || null,
        description: projectData.description,
        address: projectData.address,
        projectType: projectData.projectType || null,
        configurations: projectData.configurations ?? null,
        nearbyHighlights: projectData.nearbyHighlights?.length ? projectData.nearbyHighlights : null,
        amenities: projectData.amenities?.length ? projectData.amenities : null,
        totalUnits: projectData.totalUnits,
        availableUnits: projectData.availableUnits,
        bookedUnits: projectData.bookedUnits,
        soldUnits: projectData.soldUnits,
        reraNumber: projectData.reraNumber,
        reraExpiry: projectData.reraExpiry,
        priceFrom: projectData.priceMin ?? projectData.priceFrom,
        priceTo: projectData.priceMax ?? projectData.priceTo,
        pricePerSqftFrom: projectData.pricePerSqftMin ?? projectData.pricePerSqftFrom ?? null,
        pricePerSqftTo: projectData.pricePerSqftMax ?? projectData.pricePerSqftTo ?? null,
        maintenanceCharges: projectData.maintenanceCharges ?? null,
        floorRiseCharges: projectData.floorRiseCharges ?? null,
        commissionStructure: projectData.commissionStructure || null,
        commissionValue: projectData.commissionValue,
        cpIncentive: projectData.cpIncentive || null,
        featured: projectData.featured ?? false,
        closingSoon: projectData.closingSoon ?? false,
        possessionDate: projectData.possessionDate,
        published: projectData.published ?? true,
        status: projectData.status || 'ACTIVE',
        videoUrl: projectData.videoUrl || null,
        googleMapsLink: projectData.googleMapsLink || null,
        landArea: projectData.landArea || null,
        buildingPermitNumber: projectData.buildingPermitNumber || null,
        reraState: projectData.reraState || null,
        clubhouseAreaSqft: projectData.clubhouseAreaSqft || null,
        specifications: projectData.specifications || null,
        paymentPlans: projectData.paymentPlans || null,
        locationAdvantages: projectData.locationAdvantages || null,
        towers: projectData.towers ?? null,
        floorsPerTower: projectData.floorsPerTower ?? null,
        unitMatrix: projectData.unitMatrix ?? null,
      }
    });

    // Save the developer/company name and profile on the Builder record
    if (projectData.builderName || projectData.builderAbout || projectData.builderYearEstablished) {
      await prisma.builder.update({
        where: { id: Number(builderId) },
        data: {
          ...(projectData.builderName          && { companyName: projectData.builderName }),
          ...(projectData.builderAbout         && { about: projectData.builderAbout }),
          ...(projectData.builderYearEstablished && { yearEstablished: Number(projectData.builderYearEstablished) }),
          ...(projectData.builderDeliveredProjects && { deliveredProjects: Number(projectData.builderDeliveredProjects) }),
          ...(projectData.builderWebsite       && { website: projectData.builderWebsite }),
          ...(projectData.builderContactPhone  && { contactPhone: projectData.builderContactPhone }),
          ...(projectData.builderContactEmail  && { contactEmail: projectData.builderContactEmail }),
        },
      }).catch(() => {});
    }

    // Notify customers whose preferred city matches this project's city
    if (newProject.city) {
      const matchingCustomers = await prisma.user.findMany({
        where: {
          role: 'CUSTOMER',
          preferredCity: { equals: newProject.city, mode: 'insensitive' }
        }
      });

      if (matchingCustomers.length > 0) {
        const locality = projectData.locality ? `, ${projectData.locality}` : '';
        const notifTitle = 'New Project in Your City';
        const notifMessage = `"${newProject.name}"${locality} is now available in ${newProject.city}. Tap to explore!`;

        await Promise.all(
          matchingCustomers.map(customer =>
            Promise.all([
              prisma.deal.create({
                data: {
                  builderId: Number(builderId),
                  customerId: customer.id,
                  projectId: newProject.id,
                  status: 'New Lead'
                }
              }),
              prisma.notification.create({
                data: {
                  userId: customer.id,
                  title: notifTitle,
                  message: notifMessage,
                  type: 'info',
                  link: '/customer'
                }
              })
            ])
          )
        );

        // Push real-time event to every customer currently connected via SSE
        channelManager.publish(newProject.city, {
          type: 'new_project',
          title: notifTitle,
          message: notifMessage,
          projectId: newProject.id,
          city: newProject.city,
          timestamp: new Date().toISOString()
        });
      }
    }

    // Notify all CPs about the new project in real-time
    const cpUsers = await prisma.user.findMany({ where: { role: 'CP' }, select: { id: true } });
    if (cpUsers.length > 0) {
      const locality    = projectData.locality ? `, ${projectData.locality}` : '';
      const cpTitle     = 'New Project Listed';
      const cpMessage   = `"${newProject.name}"${locality}, ${newProject.city ?? ''} is now on the marketplace.`;
      const cpTimestamp = new Date().toISOString();

      await Promise.all(
        cpUsers.map(cp =>
          prisma.notification.create({
            data: { userId: cp.id, title: cpTitle, message: cpMessage, type: 'info', link: '/cp/projects' },
          })
        )
      );

      cpUsers.forEach(cp =>
        channelManager.publish(`user:${cp.id}`, {
          type: 'new_project',
          title: cpTitle,
          message: cpMessage,
          projectId: newProject.id,
          city: newProject.city ?? '',
          link: `/cp/projects`,
          timestamp: cpTimestamp,
        })
      );
    }

    res.json({ ok: true, data: toProjectDto(newProject as unknown as Record<string, unknown>) });
  },

  getProjects: async (req: Request, res: Response) => {
    const { builderId } = req.params;
    const { status } = req.query;

    const projects = await prisma.project.findMany({
      where: {
        builderId: Number(builderId),
        ...(status ? { status: status as string } : {})
      }
    });

    res.json({ ok: true, data: projects.map(p => toProjectDto(p as unknown as Record<string, unknown>)) });
  },

  getProject: async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const project = await prisma.project.findUnique({
      where: { id: Number(projectId) },
      include: { builder: true },
    });

    if (project) {
      const { builder, ...projectData } = project as unknown as Record<string, unknown>;
      res.json({ ok: true, data: toProjectDto(projectData, builder as Record<string, unknown> | undefined) });
    } else {
      res.status(404).json({ ok: false, message: 'Project not found' });
    }
  },

  updateProject: async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const b = req.body;

    const data: Record<string, unknown> = {};
    if (b.name               !== undefined) data.name               = b.name;
    if (b.description        !== undefined) data.description        = b.description;
    if (b.possessionDate     !== undefined) data.possessionDate     = b.possessionDate;
    if (b.status             !== undefined) data.status             = b.status;
    if (b.published          !== undefined) data.published          = b.published;
    if (b.featured           !== undefined) data.featured           = b.featured;
    if (b.closingSoon        !== undefined) data.closingSoon        = b.closingSoon;
    if (b.city               !== undefined) data.city               = b.city;
    if (b.locality           !== undefined) data.locality           = b.locality || null;
    if (b.pincode            !== undefined) data.pincode            = b.pincode || null;
    if (b.landmark           !== undefined) data.landmark           = b.landmark || null;
    if (b.address            !== undefined) data.address            = b.address || null;
    if (b.projectType        !== undefined) data.projectType        = b.projectType || null;
    if (b.configurations     !== undefined) data.configurations     = b.configurations ?? null;
    if (b.bhkTypes           !== undefined) data.configurations     = b.bhkTypes ?? null;
    if (b.nearbyHighlights   !== undefined) data.nearbyHighlights   = b.nearbyHighlights?.length ? b.nearbyHighlights : null;
    if (b.amenities          !== undefined) data.amenities          = b.amenities?.length ? b.amenities : null;
    if (b.totalUnits         !== undefined) data.totalUnits         = b.totalUnits;
    if (b.availableUnits     !== undefined) data.availableUnits     = b.availableUnits;
    if (b.bookedUnits        !== undefined) data.bookedUnits        = b.bookedUnits;
    if (b.soldUnits          !== undefined) data.soldUnits          = b.soldUnits;
    if (b.reraNumber         !== undefined) data.reraNumber         = b.reraNumber || null;
    if (b.reraId             !== undefined) data.reraNumber         = b.reraId || null;
    if (b.reraExpiry         !== undefined) data.reraExpiry         = b.reraExpiry || null;
    if (b.priceMin           !== undefined) data.priceFrom          = b.priceMin;
    if (b.priceMax           !== undefined) data.priceTo            = b.priceMax;
    if (b.pricePerSqftMin    !== undefined) data.pricePerSqftFrom   = b.pricePerSqftMin ?? null;
    if (b.pricePerSqftMax    !== undefined) data.pricePerSqftTo     = b.pricePerSqftMax ?? null;
    if (b.maintenanceCharges !== undefined) data.maintenanceCharges = b.maintenanceCharges ?? null;
    if (b.floorRiseCharges   !== undefined) data.floorRiseCharges   = b.floorRiseCharges ?? null;
    if (b.commissionStructure !== undefined) data.commissionStructure = b.commissionStructure || null;
    if (b.commissionValue    !== undefined) data.commissionValue    = b.commissionValue;
    if (b.commissionPercent  !== undefined) data.commissionValue    = b.commissionPercent;
    if (b.cpIncentive        !== undefined) data.cpIncentive        = b.cpIncentive || null;
    if (b.imageUrl           !== undefined) data.imageUrl           = b.imageUrl;
    if (b.coverUrl           !== undefined) data.imageUrl           = b.coverUrl;
    if (b.videoUrl           !== undefined) data.videoUrl           = b.videoUrl;
    if (b.googleMapsLink     !== undefined) data.googleMapsLink     = b.googleMapsLink || null;
    if (b.landArea           !== undefined) data.landArea           = b.landArea || null;
    if (b.buildingPermitNumber !== undefined) data.buildingPermitNumber = b.buildingPermitNumber || null;
    if (b.reraState          !== undefined) data.reraState          = b.reraState || null;
    if (b.clubhouseAreaSqft  !== undefined) data.clubhouseAreaSqft  = b.clubhouseAreaSqft || null;
    if (b.specifications     !== undefined) data.specifications     = b.specifications;
    if (b.paymentPlans       !== undefined) data.paymentPlans       = b.paymentPlans;
    if (b.locationAdvantages !== undefined) data.locationAdvantages = b.locationAdvantages;
    if (b.towers             !== undefined) data.towers             = b.towers ?? null;
    if (b.floorsPerTower     !== undefined) data.floorsPerTower     = b.floorsPerTower ?? null;
    if (b.unitMatrix         !== undefined) data.unitMatrix         = b.unitMatrix;

    try {
      const updatedProject = await prisma.project.update({
        where: { id: Number(projectId) },
        include: { builder: true },
        data,
      });
      const { builder, ...projectData } = updatedProject as unknown as Record<string, unknown>;
      // Also update Builder profile fields if provided
      if (b.builderName || b.builderAbout || b.builderYearEstablished || b.builderDeliveredProjects || b.builderWebsite) {
        const bid = (updatedProject as unknown as { builderId: number }).builderId;
        await prisma.builder.update({
          where: { id: bid },
          data: {
            ...(b.builderName             !== undefined && { companyName: b.builderName }),
            ...(b.builderAbout            !== undefined && { about: b.builderAbout }),
            ...(b.builderYearEstablished  !== undefined && { yearEstablished: Number(b.builderYearEstablished) || null }),
            ...(b.builderDeliveredProjects !== undefined && { deliveredProjects: Number(b.builderDeliveredProjects) || null }),
            ...(b.builderWebsite          !== undefined && { website: b.builderWebsite || null }),
          },
        }).catch(() => {});
      }
      res.json({ ok: true, data: toProjectDto(projectData, builder as Record<string, unknown> | undefined) });
    } catch (error) {
      res.status(404).json({ ok: false, message: 'Project not found' });
    }
  },

  getBuilderLeads: async (req: Request, res: Response) => {
    const { builderId } = req.params;
    const deals = await prisma.deal.findMany({
      where: { builderId: Number(builderId) },
      include: {
        customer: { select: { fullName: true, phone: true, email: true } },
        project:  { select: { name: true, commissionValue: true } },
        cp:       { include: { user: { select: { fullName: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const leads = deals.map(d => ({
      id:           String(d.id),
      customerName: d.customer?.fullName ?? 'Unknown',
      phone:        customerPhoneFor(req, d.customer?.phone),
      phoneHidden:  isBuilderRequest(req),
      email:        d.customer?.email ?? '',
      projectId:    String(d.projectId),
      projectName:  d.project?.name ?? '',
      unitType:     '',
      cpId:         d.cpId ? String(d.cpId) : '',
      cpName:       d.cp?.user?.fullName ?? '',
      budget:       d.dealValue ?? 0,
      stage:        d.status,
      notes:        '',
      source:            d.cpId ? 'CP Share' : 'Direct',
      createdAt:         d.createdAt.toISOString().split('T')[0],
      daysInStage:       Math.floor((Date.now() - new Date(d.updatedAt).getTime()) / 86_400_000),
      dealValue:         d.dealValue ?? 0,
      commissionPercent: d.project?.commissionValue ?? 0,
      commissionAmount:  d.dealValue ? (d.dealValue * (d.project?.commissionValue ?? 0)) / 100 : 0,
      commissionStatus:  d.commissionStatus ?? 'Pending',
    }));
    res.json({ ok: true, data: leads });
  },

  updateLeadStage: async (req: Request, res: Response) => {
    const { dealId } = req.params;
    const { stage } = req.body;
    try {
      const updated = await prisma.deal.update({
        where: { id: Number(dealId) },
        data:  { status: normalizeDealStatus(stage) },
      });
      res.json({ ok: true, data: { id: String(updated.id), stage: updated.status } });
    } catch {
      res.status(404).json({ ok: false, message: 'Deal not found' });
    }
  },

  getBuilderCommissions: async (req: Request, res: Response) => {
    const { builderId } = req.params;
    const deals = await prisma.deal.findMany({
      where: { builderId: Number(builderId) },
      include: {
        customer: { select: { fullName: true } },
        project:  { select: { name: true, commissionValue: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const commissions = deals
      .filter(d => d.dealValue != null)
      .map(d => {
        const pct    = d.project?.commissionValue ?? 0;
        const amount = d.dealValue! * pct / 100;
        return {
          id:                String(d.id),
          cpId:              '',
          cpName:            '',
          projectId:         String(d.projectId),
          projectName:       d.project?.name ?? '',
          unit:              '',
          customerName:      d.customer?.fullName ?? 'Unknown',
          saleValue:         d.dealValue!,
          commissionPercent: pct,
          amount,
          status:            (d.commissionStatus ?? 'Pending') as 'Pending' | 'Processing' | 'Released',
          expectedDate:      '',
          releasedDate:      d.commissionReleasedAt?.toISOString().split('T')[0],
        };
      });
    res.json({ ok: true, data: commissions });
  },

  releaseBuilderCommission: async (req: Request, res: Response) => {
    const { dealId } = req.params;
    try {
      const updated = await prisma.deal.update({
        where: { id: Number(dealId) },
        data:  { commissionStatus: 'Released', commissionReleasedAt: new Date() },
      });
      res.json({ ok: true, data: {
        id:          String(updated.id),
        status:      updated.commissionStatus,
        releasedDate: updated.commissionReleasedAt?.toISOString().split('T')[0],
      }});
    } catch {
      res.status(404).json({ ok: false, message: 'Deal not found' });
    }
  },

  updateDealStatus: async (req: Request, res: Response) => {
    const { builderId, dealId } = req.params;
    const { status } = req.body;
    try {
      const normalized = normalizeDealStatus(status);
      const updated = await prisma.deal.update({
        where: { id: Number(dealId), builderId: Number(builderId) },
        data:  { status: normalized },
        include: { project: { select: { name: true } } },
      });
      // Notify the customer and CP that the deal advanced (bell + SSE + WhatsApp).
      // Previously this endpoint changed the stage silently.
      const projectName = (updated.project as any)?.name ?? 'your deal';
      await notifyDealParties(updated.id, {
        type: 'notification',
        notifType: 'info',
        title: `Deal moved to ${normalized}`,
        message: `${projectName} is now at the "${normalized}" stage.`,
        to: ['customer', 'cp'],
        link: { customer: '/customer/journey', cp: '/cp/leads', builder: '/builder/deals' },
        whatsappTemplate: 'deal_stage_update',
        whatsappVars: ({ name }) => [name, projectName, normalized],
      }).catch(() => {});
      res.json({ ok: true, data: { id: String(updated.id), status: updated.status } });
    } catch {
      res.status(404).json({ ok: false, message: 'Deal not found' });
    }
  },

  getDocuments: async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const docs = await prisma.document.findMany({
      where: { projectId: Number(projectId) },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ ok: true, data: docs.map(d => ({
      id: d.id,
      docType: d.docType,
      fileName: d.name,
      fileUrl: d.url,
      uploadedAt: d.createdAt.toISOString(),
    })) });
  },

  uploadDocument: async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const file = (req as any).file as Express.Multer.File | undefined;
    const { docType } = req.body;
    if (!file) {
      res.status(400).json({ ok: false, message: 'No file uploaded' });
      return;
    }
    const url = `${req.protocol}://${req.get('host')}/uploads/project-docs/${file.filename}`;
    const doc = await prisma.document.create({
      data: {
        projectId: Number(projectId),
        name:      file.originalname,
        url,
        docType:   docType || 'Other',
      },
    });
    res.json({ ok: true, data: {
      id: doc.id,
      docType: doc.docType,
      fileName: doc.name,
      fileUrl: doc.url,
      uploadedAt: doc.createdAt.toISOString(),
    }});
  },

  uploadProjectImage: async (req: Request, res: Response) => {
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
      res.status(400).json({ ok: false, message: 'No file uploaded' });
      return;
    }
    const url = `${req.protocol}://${req.get('host')}/uploads/project-images/${file.filename}`;
    res.json({ ok: true, data: url });
  },

  getPublicProjects: async (req: Request, res: Response) => {
    const { city, builderId } = req.query;

    const projects = await prisma.project.findMany({
      where: {
        published: true,
        ...(city ? { city: { equals: city as string, mode: 'insensitive' } } : {}),
        ...(builderId ? { builderId: Number(builderId) } : {}),
      },
      include: { builder: { select: { companyName: true, user: { select: { fullName: true } } } } },
    });

    res.json({
      ok: true,
      data: projects.map(p => {
        const { priceFrom, priceTo, builder, ...rest } = p as any;
        return {
          ...rest,
          priceMin: priceFrom ?? null,
          priceMax: priceTo ?? null,
          builderName: builder?.companyName || builder?.user?.fullName || null,
        };
      }),
    });
  },

  getPublicBuilders: async (_req: Request, res: Response) => {
    const builders = await prisma.builder.findMany({
      where: { projects: { some: { published: true } } },
      select: {
        id: true,
        companyName: true,
        user: { select: { fullName: true } },
        _count: { select: { projects: { where: { published: true } } } },
      },
    });

    res.json({
      ok: true,
      data: builders
        .filter(b => b.companyName || b.user?.fullName)
        .map(b => ({
          id: b.id,
          name: b.companyName || b.user?.fullName || 'Builder',
          projectCount: b._count.projects,
        })),
    });
  },

  // ── Public: resolve a CP share token ─────────────────────────────────
  resolveShareToken: async (req: Request, res: Response) => {
    const token = String(req.params.token);

    const link = await prisma.projectShareLink.findFirst({ where: { token } });

    if (!link) {
      res.status(404).json({ ok: false, message: 'Share link not found or expired' });
      return;
    }

    // Fetch related data
    const [project, cp] = await Promise.all([
      prisma.project.findUnique({
        where: { id: link.projectId },
        include: { builder: { select: { companyName: true, user: { select: { fullName: true } } } } },
      }),
      link.cpId ? prisma.channelPartner.findUnique({ where: { id: link.cpId }, select: { userId: true } }) : null,
    ]);

    if (!project) {
      res.status(404).json({ ok: false, message: 'Project not found' });
      return;
    }

    // Increment click count (fire-and-forget)
    prisma.projectShareLink.update({
      where: { id: link.id },
      data: { clickCount: { increment: 1 } },
    }).catch(() => {});

    const { priceFrom, priceTo, builder, ...rest } = project as any;
    res.json({
      ok: true,
      data: {
        projectId:  link.projectId,
        cpUserId:   cp?.userId ?? null,
        clickCount: link.clickCount + 1,
        project: {
          ...rest,
          priceMin:    priceFrom ?? null,
          priceMax:    priceTo   ?? null,
          builderName: builder?.companyName || builder?.user?.fullName || null,
        },
      },
    });
  },

  // Portal (Meeting) interactions
  createLeadFromShare: async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const { cpUserId, customerName, customerPhone, stage } = req.body;
    // Default: customer self-registers via share link → 'Profile Created'
    // CP manually adding via button passes stage='NEW_LEAD' explicitly via cpApi.createLead
    const leadStatus = stage ?? 'Profile Created';

    if (!customerPhone) {
      res.status(400).json({ ok: false, message: 'customerPhone is required' });
      return;
    }

    const project = await prisma.project.findUnique({
      where: { id: Number(projectId) },
      include: { builder: { select: { id: true, userId: true } } },
    });
    if (!project) {
      res.status(404).json({ ok: false, message: 'Project not found' });
      return;
    }

    let customer = await prisma.user.findUnique({ where: { phone: customerPhone } });
    if (!customer) {
      customer = await prisma.user.create({
        data: { phone: customerPhone, fullName: customerName ?? 'Customer', role: 'CUSTOMER' },
      });
    }

    const cp = cpUserId
      ? await prisma.channelPartner.findFirst({ where: { userId: Number(cpUserId) } })
      : null;

    const existingDeal = await prisma.deal.findFirst({
      where: { projectId: project.id, customerId: customer.id, builderId: project.builderId },
    });

    let deal;
    if (existingDeal) {
      deal = await prisma.deal.update({
        where: { id: existingDeal.id },
        data: { status: leadStatus, ...(cp ? { cpId: cp.id } : {}) },
      });
    } else {
      deal = await prisma.deal.create({
        data: {
          projectId:  project.id,
          builderId:  project.builderId,
          customerId: customer.id,
          status:     leadStatus,
          ...(cp ? { cpId: cp.id } : {}),
        },
      });
    }

    if (project.builder?.userId) {
      const title = 'New Lead via CP Share';
      const message = `${customer.fullName ?? customerPhone} registered interest in "${project.name}" via a CP share link.`;
      await prisma.notification.create({
        data: { userId: project.builder.userId, title, message, type: 'info', link: '/builder/leads' },
      });
      channelManager.publish(`user:${project.builder.userId}`, {
        type: 'new_lead', title, message, city: '', timestamp: new Date().toISOString(),
      });
    }

    res.json({ ok: true, data: { dealId: deal.id, customerId: customer.id } });
  },

  // GET /customer/booked-slots?builderId=X&date=YYYY-MM-DD
  // Returns time slots already confirmed by the builder on that date so customers can't request taken slots
  getBookedSlots: async (req: Request, res: Response) => {
    const { builderId, date } = req.query as { builderId?: string; date?: string };
    if (!builderId || !date) return res.json({ ok: true, data: [] });

    const meetings = await prisma.meeting.findMany({
      where: {
        builderId: Number(builderId),
        status: { in: ['Confirmed', 'CONFIRMED'] },
        confirmedDate: date,
      },
      select: { confirmedTime: true },
    });
    const slots = meetings.map(m => m.confirmedTime).filter(Boolean) as string[];
    res.json({ ok: true, data: slots });
  },

  bookMeeting: async (req: Request, res: Response) => {
    const meetingData = req.body;

    // Reject if the requested slot is already confirmed for another meeting
    const slotTaken = await prisma.meeting.findFirst({
      where: {
        builderId: meetingData.builderId,
        status: { in: ['Confirmed', 'CONFIRMED'] },
        confirmedDate: meetingData.preferredDate,
        confirmedTime: meetingData.preferredTime,
      },
    });
    if (slotTaken) {
      return res.status(409).json({ ok: false, message: `The ${meetingData.preferredTime} slot on ${meetingData.preferredDate} is already confirmed for another customer. Please choose a different time.` });
    }

    let customer = await prisma.user.findUnique({ where: { phone: meetingData.customerPhone } });
    if (!customer) {
      customer = await prisma.user.create({
        data: { phone: meetingData.customerPhone, fullName: meetingData.customerName, role: 'CUSTOMER' }
      });
    }

    // Resolve CP: explicit selection by userId takes priority, then look up from existing deal
    let cpId: number | null = null;
    if (meetingData.cpUserId) {
      const cp = await prisma.channelPartner.findUnique({ where: { userId: Number(meetingData.cpUserId) }, select: { id: true } });
      cpId = cp?.id ?? null;
    }
    if (!cpId && meetingData.projectId && customer.id) {
      const deal = await prisma.deal.findFirst({
        where: { projectId: Number(meetingData.projectId), customerId: customer.id, cpId: { not: null } },
        select: { cpId: true },
      });
      cpId = deal?.cpId ?? null;
    }

    const newMeeting = await prisma.meeting.create({
      data: {
        projectId: meetingData.projectId,
        customerId: customer.id,
        builderId: meetingData.builderId,
        cpId,
        customerPhone: meetingData.customerPhone,
        customerName: meetingData.customerName,
        preferredDate: meetingData.preferredDate,
        preferredTime: meetingData.preferredTime,
        meetingType: meetingData.meetingType,
        notes: meetingData.notes,
        status: 'Pending'
      },
      include: { project: { select: { name: true } } }
    });

    // A meeting booked through a CP locks the customer to that CP for 90 days
    // (best-effort — meeting booking is never blocked by an existing lock).
    if (cpId && meetingData.projectId) {
      await assignCustomerToCp(cpId, customer.id, Number(meetingData.projectId)).catch(() => {});
    }

    const projectName = newMeeting.project?.name ?? 'your project';
    const ts = new Date().toISOString();

    // Upsert a Deal so the lead appears in the builder's Leads & Meetings page
    if (meetingData.projectId) {
      try {
        const existingDeal = await prisma.deal.findFirst({
          where: {
            builderId:  meetingData.builderId,
            customerId: customer.id,
            projectId:  Number(meetingData.projectId),
          },
          select: { id: true, status: true },
        });

        const stagesAlreadyPast = ['Meeting Confirmed', 'Meeting Done', 'Negotiation', 'Booked', 'Closed'];

        if (existingDeal) {
          // Only move backward if the lead hasn't already progressed past "Meeting Requested"
          if (!stagesAlreadyPast.includes(existingDeal.status)) {
            await prisma.deal.update({
              where: { id: existingDeal.id },
              data: { status: 'Meeting Requested', ...(cpId ? { cpId } : {}) },
            });
          }
        } else {
          await prisma.deal.create({
            data: {
              builderId:  meetingData.builderId,
              customerId: customer.id,
              projectId:  Number(meetingData.projectId),
              status:     'Meeting Requested',
              ...(cpId ? { cpId } : {}),
            },
          });
        }
      } catch { /* best-effort — meeting is still saved */ }
    }

    // Notify the builder
    const builder = await prisma.builder.findUnique({
      where: { id: meetingData.builderId },
      select: { userId: true }
    });

    if (builder) {
      const notifTitle = 'New Meeting Request';
      const notifMessage = `${meetingData.customerName} has requested a ${meetingData.meetingType ?? 'site visit'} for "${projectName}" on ${meetingData.preferredDate} at ${meetingData.preferredTime}.`;
      await prisma.notification.create({
        data: { userId: builder.userId, title: notifTitle, message: notifMessage, type: 'info', link: '/builder/meetings' }
      });
      channelManager.publish(`user:${builder.userId}`, {
        type: 'meeting_request', title: notifTitle, message: notifMessage, city: '', timestamp: ts, link: '/builder/meetings',
      });
    }

    // Notify the CP if one is linked
    if (cpId) {
      const cp = await prisma.channelPartner.findUnique({ where: { id: cpId }, select: { user: { select: { id: true } } } });
      if (cp?.user?.id) {
        const cpTitle = 'Meeting Request Submitted';
        const cpMsg = `${meetingData.customerName} has requested a ${meetingData.meetingType ?? 'site visit'} for "${projectName}" on ${meetingData.preferredDate}.`;
        await prisma.notification.create({
          data: { userId: cp.user.id, title: cpTitle, message: cpMsg, type: 'info', link: '/cp/meetings' }
        });
        channelManager.publish(`user:${cp.user.id}`, {
          type: 'meeting_request', title: cpTitle, message: cpMsg, city: '', timestamp: ts, link: '/cp/meetings',
        });
      }
    }

    res.json({ ok: true, data: { ...newMeeting, projectName } });
  },

  // Accept, reschedule, or reject a meeting request; confirming creates a Deal (lead)
  updateMeetingStatus: async (req: Request, res: Response) => {
    const { builderId, meetingId } = req.params;
    const { status, notes: builderNotes, confirmedDate, confirmedTime } = req.body;

    const allowed = ['Confirmed', 'Rescheduled', 'Cancelled', 'Completed', 'Follow-up Required'];
    if (!allowed.includes(status)) {
      res.status(400).json({ ok: false, message: `Invalid status. Allowed: ${allowed.join(', ')}` });
      return;
    }

    let meeting;
    try {
      meeting = await prisma.meeting.update({
        where: { id: Number(meetingId) },
        data: {
          status,
          ...(builderNotes  ? { builderNotes }  : {}),
          ...(confirmedDate ? { confirmedDate } : {}),
          ...(confirmedTime ? { confirmedTime } : {}),
        },
        include: {
          project: { select: { name: true, address: true, city: true } },
          customer: { select: { email: true, fullName: true } },
        },
      });
    } catch (err) {
      res.status(404).json({ ok: false, message: 'Meeting not found' });
      return;
    }

    // Sync deal stage to mirror the meeting lifecycle
    if (meeting.projectId && (status === 'Confirmed' || status === 'Completed')) {
      try {
        const dealStatus = status === 'Confirmed' ? 'Meeting Confirmed' : 'Meeting Done';
        const cpRecord = meeting.cpId
          ? await prisma.channelPartner.findUnique({ where: { id: meeting.cpId }, select: { id: true } })
          : null;
        const existing = await prisma.deal.findFirst({
          where: { builderId: Number(builderId), customerId: meeting.customerId, projectId: meeting.projectId },
          select: { id: true },
        });
        if (existing) {
          await prisma.deal.update({ where: { id: existing.id }, data: { status: dealStatus } });
        } else if (status === 'Confirmed') {
          // Only create a new deal on first Confirm, not on Completed (deal should already exist)
          await prisma.deal.create({
            data: {
              builderId: Number(builderId),
              customerId: meeting.customerId,
              projectId: meeting.projectId,
              cpId: cpRecord?.id ?? null,
              status: dealStatus,
            },
          });
        }
      } catch {
        // Deal sync is best-effort
      }
    }

    const projectName = meeting.project?.name ?? 'your project';
    const dateStr     = meeting.confirmedDate ?? meeting.preferredDate;
    const timeStr     = meeting.confirmedTime ?? meeting.preferredTime;
    const ts          = new Date().toISOString();

    // Send calendar invites on Confirmed or Rescheduled
    if (status === 'Confirmed' || status === 'Rescheduled') {
      try {
        const builderRecord = await prisma.builder.findUnique({
          where: { id: Number(builderId) },
          select: { contactEmail: true, user: { select: { email: true, fullName: true } } },
        });

        const builderEmail  = builderRecord?.contactEmail ?? builderRecord?.user?.email ?? '';
        const builderName   = builderRecord?.user?.fullName ?? 'Builder';
        const customerEmail = meeting.customer?.email ?? '';
        const customerName  = meeting.customer?.fullName ?? meeting.customerName;

        // Fetch CP email if linked
        let cpEmail = '';
        let cpName  = '';
        if (meeting.cpId) {
          const cpRecord = await prisma.channelPartner.findUnique({
            where: { id: meeting.cpId },
            select: { user: { select: { email: true, fullName: true } } },
          });
          cpEmail = cpRecord?.user?.email ?? '';
          cpName  = cpRecord?.user?.fullName ?? 'Channel Partner';
        }

        const location = [meeting.project?.address, meeting.project?.city]
          .filter(Boolean).join(', ') || projectName;

        // The builder is the ICS organizer, so the shared description must not
        // expose the customer's phone — only the CP brokers contact.
        const description =
          `Site visit for ${projectName}\n` +
          `Customer: ${customerName}\n` +
          (meeting.meetingType ? `Type: ${meeting.meetingType}\n` : '') +
          (meeting.notes ? `Notes: ${meeting.notes}` : '');

        const attendees = [
          { email: customerEmail, name: customerName, role: 'REQ-PARTICIPANT' as const },
          ...(cpEmail ? [{ email: cpEmail, name: cpName, role: 'REQ-PARTICIPANT' as const }] : []),
        ];

        if (builderEmail && dateStr && timeStr) {
          const icsContent = generateICS({
            uid: `meeting-${meeting.id}-${Date.now()}@dealio.com`,
            summary: `Site Visit — ${projectName}`,
            description,
            location,
            dateStr,
            timeStr,
            organizer: { email: builderEmail, name: builderName, role: 'CHAIR' },
            attendees,
          });

          const subject =
            status === 'Confirmed'
              ? `Site Visit Confirmed — ${projectName} on ${dateStr} at ${timeStr}`
              : `Site Visit Rescheduled — ${projectName} now on ${dateStr} at ${timeStr}`;

          const htmlBody = `
<p>Hi,</p>
<p>Your site visit for <strong>${projectName}</strong> has been <strong>${status.toLowerCase()}</strong>.</p>
<ul>
  <li><strong>Date:</strong> ${dateStr}</li>
  <li><strong>Time:</strong> ${timeStr}</li>
  <li><strong>Location:</strong> ${location}</li>
</ul>
<p>Please find the calendar invite attached. Add it to your calendar to get a reminder.</p>
<p>— Dealio Platform</p>`;

          const recipients = [
            { email: builderEmail, name: builderName },
            ...attendees.filter(a => a.email),
          ];

          sendCalendarInvite({
            to: recipients,
            subject,
            htmlBody,
            icsContent,
            filename: `dealio-site-visit-${meeting.id}.ics`,
          }).catch(err => console.error('[calendarInvite] email error:', err));
        }
      } catch (err) {
        console.error('[calendarInvite] failed to send calendar invite:', err);
      }
    }

    // Notify the customer about the meeting status change
    const notifMeta: Record<string, { title: string; type: string; evtType: string }> = {
      Confirmed:            { title: 'Meeting Confirmed',         type: 'success', evtType: 'meeting_confirmed'   },
      Rescheduled:          { title: 'Meeting Rescheduled',       type: 'warning', evtType: 'meeting_rescheduled' },
      Cancelled:            { title: 'Meeting Cancelled',         type: 'error',   evtType: 'meeting_cancelled'   },
      Completed:            { title: 'Meeting Completed',         type: 'success', evtType: 'meeting_completed'   },
      'Follow-up Required': { title: 'Follow-up Requested',       type: 'info',    evtType: 'meeting_followup'    },
    };
    const meta = notifMeta[status];
    if (meta) {
      const msgByStatus: Record<string, string> = {
        Confirmed:            `Your visit to "${projectName}" is confirmed for ${dateStr} at ${timeStr}.`,
        Rescheduled:          `Your visit to "${projectName}" has been rescheduled to ${dateStr} at ${timeStr}.`,
        Cancelled:            `Your visit to "${projectName}" has been cancelled.`,
        Completed:            `Your visit to "${projectName}" is marked as completed.`,
        'Follow-up Required': `The builder has requested a follow-up for "${projectName}".`,
      };
      const customerMsg = msgByStatus[status] ?? `Your meeting status is now: ${status}.`;

      await prisma.notification.create({
        data: { userId: meeting.customerId, title: meta.title, message: customerMsg, type: meta.type, link: '/customer/meeting' },
      });
      channelManager.publish(`user:${meeting.customerId}`, {
        type: meta.evtType as any, title: meta.title, message: customerMsg,
        meetingId: meeting.id, city: '', link: '/customer/meeting', timestamp: ts,
      });
    }

    // Notify the CP if one is linked
    if (meeting.cpId) {
      const cp = await prisma.channelPartner.findUnique({ where: { id: meeting.cpId }, select: { user: { select: { id: true } } } });
      if (cp?.user?.id) {
        const cpMsgByStatus: Record<string, string> = {
          Confirmed:            `Builder confirmed the visit for ${meeting.customerName} at "${projectName}" on ${dateStr} at ${timeStr}.`,
          Rescheduled:          `Builder rescheduled ${meeting.customerName}'s visit to "${projectName}" → ${dateStr} at ${timeStr}.`,
          Cancelled:            `Builder cancelled ${meeting.customerName}'s visit to "${projectName}".`,
          Completed:            `${meeting.customerName}'s visit to "${projectName}" is now marked as completed.`,
          'Follow-up Required': `Builder requested a follow-up for ${meeting.customerName}'s visit to "${projectName}".`,
        };
        const cpMsg = cpMsgByStatus[status] ?? `Meeting status updated to ${status}.`;
        await prisma.notification.create({
          data: { userId: cp.user.id, title: meta?.title ?? 'Meeting Update', message: cpMsg, type: meta?.type ?? 'info', link: '/cp/meetings' },
        });
        channelManager.publish(`user:${cp.user.id}`, {
          type: (meta?.evtType ?? 'notification') as any, title: meta?.title ?? 'Meeting Update',
          message: cpMsg, city: '', timestamp: ts, link: '/cp/meetings',
        });
      }
    }

    res.json({ ok: true, data: { ...meeting, projectName } });
  },

  // All deals for a builder with customer + project info
  getBuilderDeals: async (req: Request, res: Response) => {
    const builderId = parseInt(req.params.builderId as string, 10);
    if (isNaN(builderId)) return res.status(400).json({ ok: false, message: 'Invalid builderId' });
    const deals = await prisma.deal.findMany({
      where: { builderId },
      include: {
        customer: { select: { fullName: true, phone: true, email: true } },
        project:  { select: { name: true } },
        cp:       { select: { user: { select: { fullName: true } } } },
      },
      orderBy: { createdAt: 'desc' }
    });
    const mapped = deals.map(d => ({
      id: d.id,
      status: d.status,
      dealValue: d.dealValue,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      customerId: d.customerId,
      customerName: d.customer?.fullName ?? 'Unknown',
      customerPhone: customerPhoneFor(req, d.customer?.phone),
      phoneHidden: isBuilderRequest(req),
      customerEmail: d.customer?.email ?? null,
      projectId: d.projectId,
      projectName: d.project?.name ?? 'Unknown Project',
      cpId: d.cpId,
      cpName: d.cp?.user?.fullName ?? null,
    }));
    res.json({ ok: true, data: mapped });
  },

  // All meetings for a specific builder
  getBuilderMeetings: async (req: Request, res: Response) => {
    const { builderId } = req.params;
    const meetings = await prisma.meeting.findMany({
      where: { builderId: Number(builderId) },
      include: {
        project: { select: { name: true } },
        // cpId resolves via ChannelPartner → User for the CP name
      },
      orderBy: { createdAt: 'desc' }
    });

    // Batch-load CP names + userIds for meetings that have a cpId
    const cpIds = [...new Set(meetings.map(m => (m as any).cpId).filter(Boolean))];
    const cpMap: Record<number, { name: string; userId: number | null }> = {};
    if (cpIds.length > 0) {
      const cps = await prisma.channelPartner.findMany({
        where: { id: { in: cpIds } },
        select: { id: true, userId: true, user: { select: { fullName: true } } },
      });
      cps.forEach(cp => { cpMap[cp.id] = { name: cp.user?.fullName ?? 'CP', userId: cp.userId }; });
    }

    const mapped = meetings.map(m => ({
      ...m,
      customerPhone: customerPhoneFor(req, m.customerPhone),
      phoneHidden: isBuilderRequest(req),
      projectName: m.project?.name ?? 'Unknown Project',
      cpName:   (m as any).cpId ? (cpMap[(m as any).cpId]?.name   ?? null) : null,
      cpUserId: (m as any).cpId ? (cpMap[(m as any).cpId]?.userId ?? null) : null,
      project: undefined,
    }));
    res.json({ ok: true, data: mapped });
  },

  // Customer meetings filtered by phone — flattens projectName
  getMeetings: async (req: Request, res: Response) => {
    const { phone } = req.query;
    const meetings = await prisma.meeting.findMany({
      where: { ...(phone ? { customerPhone: phone as string } : {}) },
      include: { project: { select: { name: true } } },
      orderBy: { createdAt: 'desc' }
    });
    const mapped = meetings.map(m => ({
      ...m,
      projectName: m.project?.name ?? 'Unknown Project',
      project: undefined
    }));
    res.json({ ok: true, data: mapped });
  },

  rateCustomerMeeting: async (req: Request, res: Response) => {
    const meetingId = Number(req.params.id);
    const { rating } = req.body;
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ ok: false, message: 'Rating must be between 1 and 5' });
    }
    try {
      await prisma.meeting.update({
        where: { id: meetingId },
        data: { customerRating: Number(rating) },
      });
      res.json({ ok: true });
    } catch {
      res.status(404).json({ ok: false, message: 'Meeting not found' });
    }
  },

  getCustomerDeals: async (req: Request, res: Response) => {
    const { phone } = req.query;
    if (!phone) return res.json({ ok: true, data: [] });
    const customer = await prisma.user.findUnique({ where: { phone: phone as string } });
    if (!customer) return res.json({ ok: true, data: [] });
    const deals = await prisma.deal.findMany({
      where: { customerId: customer.id },
      include: {
        project:       { select: { name: true } },
        builder:       { select: { companyName: true, user: { select: { fullName: true } } } },
        cp:            { select: { user: { select: { fullName: true } } } },
        loanCase:      { select: { id: true, loanAmount: true, status: true, tenureMonths: true, interestRate: true } },
        dealDocuments: { where: { sharedWithCustomer: true }, orderBy: { createdAt: 'asc' } },
        messages:      { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
    // Map stored bank statuses to the codes the customer's milestone tracker expects.
    const LOAN_STATUS_UI: Record<string, string> = { 'Applied': 'SUBMITTED', 'Under Review': 'UNDER_REVIEW', 'Documents Submitted': 'UNDER_REVIEW', 'Sanctioned': 'APPROVED', 'Disbursed': 'DISBURSED', 'Rejected': 'REJECTED' };
    const mapped = deals.map(d => ({
      dealId:            d.id,
      projectId:         d.projectId,
      projectName:       (d.project as any)?.name ?? 'Unknown Project',
      builderName:       (d.builder as any)?.companyName ?? (d.builder as any)?.user?.fullName ?? 'Builder',
      cpName:            (d.cp as any)?.user?.fullName ?? null,
      dealStatus:        d.status,
      dealValue:         d.dealValue,
      customerConfirmed: d.customerConfirmed,
      cpAgreed:          d.cpAgreed,
      createdAt:         d.createdAt,
      loanCaseId:        (d.loanCase as any)?.id           ?? null,
      loanAmount:        (d.loanCase as any)?.loanAmount   ?? null,
      loanStatus:        (d.loanCase as any)?.status ? (LOAN_STATUS_UI[(d.loanCase as any).status] ?? (d.loanCase as any).status) : null,
      tenureMonths:      (d.loanCase as any)?.tenureMonths ?? null,
      interestRate:      (d.loanCase as any)?.interestRate ?? null,
      dealDocuments:     (d.dealDocuments as any[]).map(doc => ({
        id: doc.id, name: doc.name, docType: doc.docType,
        fileUrl: doc.fileUrl, createdAt: doc.createdAt.toISOString(),
      })),
      messages: (d.messages as any[]).map(m => ({
        id: m.id, senderName: m.senderName, senderRole: m.senderRole,
        threadKey: m.threadKey, message: m.message, createdAt: m.createdAt.toISOString(),
      })),
    }));
    res.json({ ok: true, data: mapped });
  },

  // SSE stream — registers builder in their personal user:${userId} channel
  streamNotifications: async (req: Request, res: Response) => {
    const userId = req.user!.id;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const channelKey = `user:${userId}`;
    channelManager.subscribe(channelKey, userId, res);

    res.write(`data: ${JSON.stringify({ type: 'connected', title: '', message: 'Notification stream connected', city: '', timestamp: new Date().toISOString() })}\n\n`);

    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { clearInterval(heartbeat); }
    }, 25_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      channelManager.unsubscribe(channelKey, userId);
    });
  },

  getProjectPdf: async (req: Request, res: Response) => {
    const { projectId } = req.params;

    const project = await prisma.project.findUnique({
      where: { id: Number(projectId) },
      include: {
        builder: { select: { companyName: true, user: { select: { fullName: true } } } },
        documents: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!project) {
      res.status(404).json({ ok: false, message: 'Project not found' });
      return;
    }

    const fmt = (n: number) => {
      if (n >= 10_000_000) return `Rs. ${(n / 10_000_000).toFixed(2)} Cr`;
      if (n >= 100_000)    return `Rs. ${(n / 100_000).toFixed(0)} L`;
      return `Rs. ${n.toLocaleString('en-IN')}`;
    };
    const fmtPrice = (min?: number | null, max?: number | null) => {
      if (!min && !max) return 'Price on request';
      if (min && max)   return `${fmt(min)} - ${fmt(max)}`;
      return fmt(min || max || 0);
    };
    const builderName = project.builder?.companyName || project.builder?.user?.fullName || 'Builder';
    const location    = [project.address, project.city].filter(Boolean).join(', ') || project.city || '';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${project.name.replace(/[^a-z0-9]/gi, '_')}_brochure.pdf"`);

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    doc.pipe(res);

    const TEAL      = '#0A7E8C';
    const ORANGE    = '#E87722';
    const DARK      = '#0F2035';
    const MUTED     = '#64748b';
    const LIGHT_BG  = '#f8fafc';
    const PAGE_W    = doc.page.width - 100;   // usable width (50 margins each side)

    /* ── Header banner ── */
    doc.rect(0, 0, doc.page.width, 72).fill(DARK);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20).text('DEALIO', 50, 22);
    doc.fillColor(ORANGE).font('Helvetica').fontSize(9).text('Real Estate Platform', 50, 46);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11)
      .text('PROJECT BROCHURE', 0, 28, { align: 'right', width: doc.page.width - 50 });
    doc.fillColor(TEAL).rect(0, 72, doc.page.width, 4).fill();

    /* ── Project title ── */
    doc.moveDown(1.5);
    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(26).text(project.name, 50, 100);
    if (builderName) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(12).text(`by ${builderName}`, 50, 132);
    }
    if (location) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(10).text(`\u{1F4CD}  ${location}`, 50, 150);
    }

    /* ── Coloured accent line ── */
    doc.moveDown(0.5);
    const lineY = doc.y + 6;
    doc.rect(50, lineY, 40, 3).fill(ORANGE);
    doc.moveDown(1.2);

    /* ── Helper: section heading ── */
    const sectionHead = (title: string) => {
      doc.moveDown(0.6);
      doc.fillColor(TEAL).font('Helvetica-Bold').fontSize(11).text(title.toUpperCase());
      doc.moveDown(0.2);
      doc.moveTo(50, doc.y).lineTo(50 + PAGE_W, doc.y).strokeColor('#e2e8f0').lineWidth(1).stroke();
      doc.moveDown(0.4);
    };

    /* ── Key details grid ── */
    sectionHead('Key Details');
    const details: [string, string][] = [
      ['Price Range', fmtPrice(project.priceFrom, project.priceTo)],
      ['Status',      (project.status || '').replace(/_/g, ' ')],
      ['Possession',  project.possessionDate || '—'],
      ['Total Units', project.totalUnits != null ? String(project.totalUnits) : '—'],
      ['Available',   project.availableUnits != null ? String(project.availableUnits) : '—'],
      ['Booked',      project.bookedUnits != null ? String(project.bookedUnits) : '—'],
      ['Sold',        project.soldUnits != null ? String(project.soldUnits) : '—'],
    ];
    if (project.reraNumber) details.push(['RERA No.', project.reraNumber]);
    if (project.reraExpiry) details.push(['RERA Expiry', project.reraExpiry.slice(0, 10)]);

    const col = PAGE_W / 2;
    let gridX = 50, gridY = doc.y;
    details.forEach(([label, value], i) => {
      const x = gridX + (i % 2 === 0 ? 0 : col);
      const y = gridY + Math.floor(i / 2) * 28;
      doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(label, x, y);
      doc.fillColor(DARK).font('Helvetica-Bold').fontSize(10).text(value, x, y + 10, { width: col - 10 });
    });
    doc.y = gridY + Math.ceil(details.length / 2) * 28 + 10;

    /* ── Configurations ── */
    const configs: string[] = (project as any).configurations ?? [];
    if (configs.length > 0) {
      sectionHead('Configurations');
      doc.fillColor(DARK).font('Helvetica').fontSize(10).text(configs.join('   /   '));
    }

    /* ── Description ── */
    if (project.description) {
      sectionHead('About the Project');
      doc.fillColor('#374151').font('Helvetica').fontSize(10).text(project.description, { lineGap: 4 });
    }

    /* ── Amenities ── */
    const amenities: string[] = (project as any).amenities ?? [];
    if (amenities.length > 0) {
      sectionHead('Amenities');
      const perRow = 3;
      const cellW  = PAGE_W / perRow;
      let ax = 50, ay = doc.y;
      amenities.forEach((a, i) => {
        const cx = ax + (i % perRow) * cellW;
        const cy = ay + Math.floor(i / perRow) * 22;
        doc.fillColor(TEAL).circle(cx + 4, cy + 5, 2.5).fill();
        doc.fillColor(DARK).font('Helvetica').fontSize(9).text(a, cx + 10, cy, { width: cellW - 14 });
      });
      doc.y = ay + Math.ceil(amenities.length / perRow) * 22 + 8;
    }

    /* ── Nearby highlights ── */
    const nearby: string[] = (project as any).nearbyHighlights ?? [];
    if (nearby.length > 0) {
      sectionHead('Nearby Highlights');
      doc.fillColor(DARK).font('Helvetica').fontSize(10).text(nearby.join('   •   '));
    }

    /* ── Documents list ── */
    if (project.documents.length > 0) {
      sectionHead('Available Documents');
      project.documents.forEach(d => {
        doc.fillColor(TEAL).font('Helvetica-Bold').fontSize(9).text(`${d.docType}:  `, { continued: true });
        doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(d.name);
      });
    }

    /* ── Footer ── */
    const footerY = doc.page.height - 60;
    doc.rect(0, footerY, doc.page.width, 60).fill(DARK);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10)
      .text('DEALIO', 50, footerY + 14);
    doc.fillColor(ORANGE).font('Helvetica').fontSize(8)
      .text('India\'s Real Estate Platform', 50, footerY + 28);
    doc.fillColor('#ffffff').font('Helvetica').fontSize(7)
      .text(`Generated on ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}  |  dealio.in`, 0, footerY + 38, { align: 'right', width: doc.page.width - 50 });

    doc.end();
  },

  // Fetch and mark-read builder notifications
  getBuilderNotifications: async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const notifications = await prisma.notification.findMany({
      where: { userId, read: false },
      orderBy: { createdAt: 'desc' },
      take: 30
    });
    // Read-state is now persisted via PATCH /notifications/:id/read — we no longer
    // mark-read-on-fetch (that lost the unread state and made clicked notifications
    // reappear as unread after a re-hydrate).
    res.json({ ok: true, data: notifications });
  },

  // PATCH /notifications/:id/read — mark one of the caller's notifications read
  markNotificationRead: async (req: Request, res: Response) => {
    const userId = req.user!.id;
    await prisma.notification.updateMany({
      where: { id: Number(req.params.id), userId },
      data: { read: true },
    });
    res.json({ ok: true });
  },

  // PATCH /notifications/read-all — mark all the caller's unread notifications read
  markAllNotificationsRead: async (req: Request, res: Response) => {
    const userId = req.user!.id;
    await prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
    res.json({ ok: true });
  },

  // Follows a maps.app.goo.gl short link server-side and returns the expanded URL
  // so the client can extract precise coordinates (CORS blocks doing this in-browser).
  resolveMapsLink: async (req: Request, res: Response) => {
    const url = String(req.query.url ?? '');
    if (!url.startsWith('https://maps.app.goo.gl/') && !url.startsWith('https://goo.gl/maps/')) {
      return res.status(400).json({ ok: false, message: 'Only Google Maps short links are supported' });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(url, { redirect: 'follow', signal: controller.signal });
      return res.json({ ok: true, data: { resolvedUrl: response.url } });
    } catch (err) {
      const message = err instanceof Error && err.name === 'AbortError'
        ? 'Timed out resolving link'
        : 'Failed to resolve link';
      return res.status(502).json({ ok: false, message });
    } finally {
      clearTimeout(timeout);
    }
  },

  // ── Project Updates ───────────────────────────────────────────────────────

  getProjectUpdates: async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const updates = await prisma.projectUpdate.findMany({
      where: { projectId: Number(projectId) },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ ok: true, data: updates });
  },

  createProjectUpdate: async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const { title, content, type, visibleTo } = req.body;
    if (!title?.trim() || !content?.trim()) {
      return res.status(400).json({ ok: false, message: 'title and content are required' });
    }
    const update = await prisma.projectUpdate.create({
      data: {
        projectId:  Number(projectId),
        title:      title.trim(),
        content:    content.trim(),
        type:       type ?? 'announcement',
        visibleTo:  visibleTo ?? 'ALL',
      },
    });
    res.json({ ok: true, data: update });
  },

  editProjectUpdate: async (req: Request, res: Response) => {
    const { updateId } = req.params;
    const { title, content, type, visibleTo } = req.body;
    try {
      const update = await prisma.projectUpdate.update({
        where: { id: Number(updateId) },
        data: {
          ...(title     !== undefined && { title:     title.trim()   }),
          ...(content   !== undefined && { content:   content.trim() }),
          ...(type      !== undefined && { type                       }),
          ...(visibleTo !== undefined && { visibleTo                  }),
        },
      });
      res.json({ ok: true, data: update });
    } catch {
      res.status(404).json({ ok: false, message: 'Update not found' });
    }
  },

  deleteProjectUpdate: async (req: Request, res: Response) => {
    const { updateId } = req.params;
    try {
      await prisma.projectUpdate.delete({ where: { id: Number(updateId) } });
      res.json({ ok: true });
    } catch {
      res.status(404).json({ ok: false, message: 'Update not found' });
    }
  },

  // ── Broadcasts ────────────────────────────────────────────────────────────

  getBroadcasts: async (req: Request, res: Response) => {
    const { builderId } = req.params;
    const broadcasts = await prisma.broadcast.findMany({
      where: { builderId: Number(builderId) },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ ok: true, data: broadcasts });
  },

  sendBroadcast: async (req: Request, res: Response) => {
    const { builderId } = req.params;
    const { message, audience, audienceFilter, projectId, projectName } = req.body;
    if (!message?.trim()) {
      return res.status(400).json({ ok: false, message: 'message is required' });
    }

    // Resolve which CPs to notify
    const cpFilter: Record<string, unknown> = {};
    if (audience === 'By City' && audienceFilter) cpFilter.city = audienceFilter;
    if (audience === 'By Tier' && audienceFilter) cpFilter.tier = audienceFilter;

    const cps = await prisma.channelPartner.findMany({
      where: cpFilter,
      select: { userId: true },
    });

    const title = projectName
      ? `Builder Update: ${projectName}`
      : 'Broadcast from Builder';

    // Create in-app notifications for all matched CPs
    if (cps.length > 0) {
      await prisma.notification.createMany({
        data: cps.map(cp => ({
          userId:  cp.userId,
          title,
          message: message.trim(),
          type:    'info',
          link:    '/cp/projects',
        })),
      });
    }

    const broadcast = await prisma.broadcast.create({
      data: {
        builderId:     Number(builderId),
        projectId:     projectId ? Number(projectId) : null,
        projectName:   projectName ?? null,
        message:       message.trim(),
        audience,
        audienceFilter: audienceFilter ?? null,
        delivered:     cps.length,
      },
    });

    res.json({ ok: true, data: broadcast });
  },

  // Public endpoint — returns only updates visible to the requesting role
  getPublicProjectUpdates: async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const role = (req.query.role as string ?? 'CP').toUpperCase();
    const updates = await prisma.projectUpdate.findMany({
      where: {
        projectId: Number(projectId),
        OR: [
          { visibleTo: 'ALL' },
          { visibleTo: { contains: role } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ ok: true, data: updates });
  },

  // ── Loan Cases ──────────────────────────────────────────────────────────────

  getBuilderLoans: async (req: Request, res: Response) => {
    const { builderId } = req.params;
    const loans = await prisma.loanCase.findMany({
      where: { deal: { builderId: Number(builderId) } },
      include: {
        customer: { select: { fullName: true, phone: true, email: true } },
        deal: {
          select: {
            id: true, status: true,
            project: { select: { id: true, name: true } },
            cp: { select: { user: { select: { fullName: true } } } },
          },
        },
        notes: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { submittedAt: 'desc' },
    });
    res.json({ ok: true, data: loans.map(l => ({
      id: l.id,
      dealId: l.dealId,
      projectId: l.deal?.project?.id ?? l.projectId,
      projectName: l.deal?.project?.name ?? 'Unknown Project',
      customerName: l.customer?.fullName ?? 'Customer',
      customerPhone: customerPhoneFor(req, l.customer?.phone),
      phoneHidden: isBuilderRequest(req),
      customerEmail: l.customer?.email ?? '',
      employmentType: l.employmentType,
      loanAmount: l.loanAmount,
      propertyValue: l.propertyValue,
      tenureMonths: l.tenureMonths,
      bank: l.bank,
      interestRate: l.interestRate,
      emi: l.emi,
      officerName: l.officerName,
      officerPhone: l.officerPhone,
      cpName: l.deal?.cp?.user?.fullName ?? null,
      status: l.status,
      submittedAt: l.submittedAt,
      notes: l.notes,
    })) });
  },

  createBuilderLoan: async (req: Request, res: Response) => {
    const { builderId } = req.params;
    const {
      customerPhone, customerName, customerEmail,
      projectId, employmentType,
      loanAmount, propertyValue, tenureMonths,
      bank, interestRate, emi, officerName, officerPhone,
      tower, unit, floor, unitType, saleValue,
    } = req.body;

    if (!customerPhone || !projectId || !loanAmount) {
      return res.status(400).json({ ok: false, message: 'customerPhone, projectId, and loanAmount are required' });
    }

    // Find or create customer
    let customer = await prisma.user.findUnique({ where: { phone: customerPhone } });
    if (!customer) {
      customer = await prisma.user.create({
        data: { phone: customerPhone, fullName: customerName ?? 'Customer', email: customerEmail ?? null, role: 'CUSTOMER' },
      });
    }

    // Find or create deal
    let deal = await prisma.deal.findFirst({
      where: { builderId: Number(builderId), customerId: customer.id, projectId: Number(projectId) },
    });
    if (!deal) {
      deal = await prisma.deal.create({
        data: {
          builderId: Number(builderId), customerId: customer.id, projectId: Number(projectId),
          status: 'Interested Loan Required',
        },
      });
    }

    // Check for existing loan case on this deal
    const existing = await prisma.loanCase.findUnique({ where: { dealId: deal.id } });
    if (existing) {
      return res.status(409).json({ ok: false, message: 'A loan case already exists for this deal' });
    }

    const loanCase = await prisma.loanCase.create({
      data: {
        dealId: deal.id, customerId: customer.id, projectId: Number(projectId),
        loanAmount: Number(loanAmount), propertyValue: Number(propertyValue ?? saleValue ?? loanAmount),
        employmentType: employmentType ?? null, tenureMonths: tenureMonths ? Number(tenureMonths) : null,
        bank: bank ?? null, interestRate: interestRate ? Number(interestRate) : null,
        emi: emi ? Number(emi) : null, officerName: officerName ?? null, officerPhone: officerPhone ?? null,
        status: 'Applied',
      },
    });

    // Seed initial event
    await prisma.loanNote.create({
      data: {
        loanCaseId: loanCase.id, type: 'loan_initiated', sender: 'System', senderRole: 'system',
        content: `Loan application initiated — ${bank ?? 'Bank'}, ₹${Number(loanAmount).toLocaleString('en-IN')}${tenureMonths ? `, ${Math.round(Number(tenureMonths) / 12)} year tenure` : ''}`,
      },
    });

    res.json({ ok: true, data: { id: loanCase.id } });
  },

  updateLoanStatus: async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status, note, sender, senderRole } = req.body;
    const valid = ['Applied', 'Under Review', 'Documents Submitted', 'Sanctioned', 'Disbursed', 'Rejected'];
    if (!valid.includes(status)) return res.status(400).json({ ok: false, message: 'Invalid status' });

    const prev = await prisma.loanCase.findUnique({ where: { id: Number(id) }, select: { status: true } });
    const updated = await prisma.loanCase.update({ where: { id: Number(id) }, data: { status } });

    await prisma.loanNote.create({
      data: {
        loanCaseId: Number(id), type: 'status_update',
        sender: sender ?? 'System', senderRole: senderRole ?? 'system',
        content: note ?? `Status updated: ${prev?.status} → ${status}`,
      },
    });

    res.json({ ok: true, data: updated });
  },

  addLoanNote: async (req: Request, res: Response) => {
    const { id } = req.params;
    const { type, sender, senderRole, content } = req.body;
    if (!content?.trim()) return res.status(400).json({ ok: false, message: 'Content is required' });

    const note = await prisma.loanNote.create({
      data: { loanCaseId: Number(id), type: type ?? 'note', sender, senderRole, content },
    });
    res.json({ ok: true, data: note });
  },

  // ── Unit Shortlists ─────────────────────────────────────────────────────────

  createUnitShortlist: async (req: Request, res: Response) => {
    const { customerPhone, builderId, projectId, cpId, unitId, unitDetails } = req.body;
    if (!customerPhone || !builderId || !projectId || !unitId || !unitDetails) {
      return res.status(400).json({ ok: false, message: 'Missing required fields' });
    }
    const customer = await prisma.user.findUnique({ where: { phone: customerPhone } });
    if (!customer) return res.status(404).json({ ok: false, message: 'Customer not found' });

    const shortlist = await prisma.unitShortlist.create({
      data: {
        customerId: customer.id,
        builderId: Number(builderId),
        projectId: Number(projectId),
        cpId: cpId ? Number(cpId) : null,
        unitId,
        unitDetails,
      },
      include: { project: { select: { name: true } }, builder: { select: { userId: true } } },
    });

    const builderUserId = (shortlist.builder as any)?.userId;
    if (builderUserId) {
      const msg = `${customer.fullName ?? 'A customer'} shortlisted Unit ${unitId} in ${(shortlist.project as any)?.name ?? 'your project'}.`;
      await prisma.notification.create({ data: { userId: builderUserId, title: 'Unit Shortlisted', message: msg, type: 'info', link: '/builder/leads' } });
      channelManager.publish(`user:${builderUserId}`, { type: 'unit_shortlist', title: 'Unit Shortlisted', message: msg, city: '', timestamp: new Date().toISOString(), link: '/builder/leads' });
    }

    if (cpId) {
      const cp = await prisma.channelPartner.findUnique({ where: { id: Number(cpId) }, select: { userId: true } });
      if (cp) {
        const cpMsg = `${customer.fullName ?? 'Your customer'} shortlisted Unit ${unitId} in ${(shortlist.project as any)?.name ?? 'a project'}.`;
        await prisma.notification.create({ data: { userId: cp.userId, title: 'Unit Shortlisted', message: cpMsg, type: 'info', link: '/cp/meetings' } });
        channelManager.publish(`user:${cp.userId}`, { type: 'unit_shortlist', title: 'Unit Shortlisted', message: cpMsg, city: '', timestamp: new Date().toISOString(), link: '/cp/meetings' });
      }
    }

    res.json({ ok: true, data: shortlist });
  },

  getCustomerShortlists: async (req: Request, res: Response) => {
    const { phone } = req.query;
    if (!phone) return res.json({ ok: true, data: [] });
    const customer = await prisma.user.findUnique({ where: { phone: phone as string } });
    if (!customer) return res.json({ ok: true, data: [] });
    const shortlists = await prisma.unitShortlist.findMany({
      where: { customerId: customer.id },
      include: { project: { select: { name: true, city: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ ok: true, data: shortlists.map(s => ({ ...s, projectName: (s.project as any)?.name ?? 'Unknown', projectCity: (s.project as any)?.city ?? '', project: undefined })) });
  },

  getBuilderShortlists: async (req: Request, res: Response) => {
    const { builderId } = req.params;
    const shortlists = await prisma.unitShortlist.findMany({
      where: { builderId: Number(builderId) },
      include: {
        customer: { select: { fullName: true, phone: true } },
        project:  { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ ok: true, data: shortlists.map(s => ({
      ...s,
      customerName: (s.customer as any)?.fullName ?? 'Customer',
      customerPhone: customerPhoneFor(req, (s.customer as any)?.phone),
      phoneHidden: isBuilderRequest(req),
      projectName: (s.project as any)?.name ?? 'Unknown',
      customer: undefined, project: undefined,
    })) });
  },

  respondToShortlist: async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status, builderNote } = req.body;
    if (!['Accepted', 'SuggestOther'].includes(status)) {
      return res.status(400).json({ ok: false, message: 'Invalid status' });
    }
    const shortlist = await prisma.unitShortlist.update({
      where: { id: Number(id) },
      data: { status, builderNote: builderNote ?? null },
      include: { project: { select: { name: true } } },
    });

    // When builder accepts a unit shortlist, advance (or create) the deal at Negotiation stage
    if (status === 'Accepted') {
      try {
        const existing = await prisma.deal.findFirst({
          where: { builderId: Number(shortlist.builderId), customerId: shortlist.customerId, projectId: shortlist.projectId },
          select: { id: true, cpId: true },
        });

        // Resolve cpId: shortlist → meeting fallback
        let resolvedCpId: number | null = shortlist.cpId ?? null;
        if (resolvedCpId == null) {
          const mtg = await prisma.meeting.findFirst({
            where: { builderId: Number(shortlist.builderId), customerId: shortlist.customerId, projectId: shortlist.projectId, cpId: { not: null } },
            select: { cpId: true },
            orderBy: { createdAt: 'desc' },
          });
          resolvedCpId = mtg?.cpId ?? null;
        }

        if (existing) {
          await prisma.deal.update({
            where: { id: existing.id },
            data: {
              status: 'Negotiation',
              ...(existing.cpId == null && resolvedCpId != null ? { cpId: resolvedCpId } : {}),
            },
          });
        } else {
          await prisma.deal.create({
            data: {
              builderId: Number(shortlist.builderId),
              customerId: shortlist.customerId,
              projectId:  shortlist.projectId,
              cpId:       resolvedCpId,
              status:     'Negotiation',
            },
          });
        }
      } catch { /* best-effort */ }
    }

    const label = status === 'Accepted' ? 'accepted' : 'has a suggestion for';
    const msg = `The builder ${label} your shortlisted unit (${shortlist.unitId}) in ${(shortlist.project as any)?.name ?? 'the project'}.${builderNote ? ` Note: ${builderNote}` : ''}`;
    await prisma.notification.create({ data: { userId: shortlist.customerId, title: status === 'Accepted' ? 'Unit Accepted!' : 'Choose Another Unit', message: msg, type: 'info', link: '/customer/property' } });
    channelManager.publish(`user:${shortlist.customerId}`, { type: 'shortlist_response', title: status === 'Accepted' ? 'Unit Accepted!' : 'Choose Another Unit', message: msg, city: '', timestamp: new Date().toISOString(), link: '/customer/property' });
    res.json({ ok: true, data: shortlist });
  },

  // GET /:builderId/deals/:dealId — full deal detail
  getDeal: async (req: Request, res: Response) => {
    const { builderId, dealId } = req.params;
    const deal = await prisma.deal.findUnique({
      where: { id: Number(dealId), builderId: Number(builderId) },
      include: {
        customer: { select: { fullName: true, phone: true, email: true } },
        project:  { select: { name: true, commissionValue: true } },
        cp:       { select: { tier: true, user: { select: { fullName: true, phone: true } } } },
        messages:     { orderBy: { createdAt: 'asc' } },
        dealDocuments:{ orderBy: { createdAt: 'asc' } },
      },
    });
    if (!deal) return res.status(404).json({ ok: false, message: 'Deal not found' });
    const tierRates: Record<string, number> = { Silver: 1.5, Gold: 2.0, Platinum: 2.5 };
    const cpTier    = (deal.cp as any)?.tier ?? 'Silver';
    const commPct   = (deal.project as any)?.commissionValue > 0 ? (deal.project as any).commissionValue : (tierRates[cpTier] ?? 1.5);
    const commAmount = deal.dealValue ? deal.dealValue * commPct / 100 : null;
    res.json({ ok: true, data: {
      ...deal,
      customerName:  (deal.customer as any)?.fullName ?? 'Unknown',
      customerPhone: customerPhoneFor(req, (deal.customer as any)?.phone),
      phoneHidden:   isBuilderRequest(req),
      projectName:   (deal.project as any)?.name ?? 'Unknown',
      cpName:        (deal.cp as any)?.user?.fullName ?? null,
      cpPhone:       (deal.cp as any)?.user?.phone ?? null,
      cpTier,
      commissionPercent: commPct,
      commissionAmount:  commAmount,
      customer: undefined, project: undefined, cp: undefined,
    }});
  },

  // POST /:builderId/deals/:dealId/upload — multipart file upload for a deal document
  uploadDealDocument: async (req: Request, res: Response) => {
    const { builderId, dealId } = req.params;
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ ok: false, message: 'No file uploaded' });
    const { docType, sharedWithCp, sharedWithCustomer } = req.body;
    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/deal-docs/${file.filename}`;
    const doc = await prisma.dealDocument.create({
      data: {
        dealId:             Number(dealId),
        name:               file.originalname,
        docType:            docType || 'Other',
        fileUrl,
        uploadedByRole:     'builder',
        sharedWithCp:       sharedWithCp === 'true' || sharedWithCp === true,
        sharedWithCustomer: sharedWithCustomer === 'true' || sharedWithCustomer === true,
      },
    });
    const deal = await prisma.deal.findUnique({
      where: { id: Number(dealId) },
      include: { cp: { select: { userId: true } }, project: { select: { name: true } } },
    });
    // Fan out (bell + SSE + opt-in WhatsApp) to whichever parties the doc is shared with.
    const docProject = (deal?.project as any)?.name ?? 'your deal';
    const docTargets: ('cp' | 'customer')[] = [
      ...(doc.sharedWithCp ? ['cp' as const] : []),
      ...(doc.sharedWithCustomer ? ['customer' as const] : []),
    ];
    if (docTargets.length) {
      await notifyDealParties(Number(dealId), {
        type: 'deal_doc',
        title: 'Document Shared',
        message: `Builder shared "${file.originalname}" for ${docProject}.`,
        to: docTargets,
        link: { cp: '/cp/leads', customer: '/customer/journey' },
        whatsappTemplate: 'deal_document_shared',
      }).catch(() => {});
    }
    res.json({ ok: true, data: {
      id: doc.id, name: doc.name, docType: doc.docType, fileUrl: doc.fileUrl,
      uploadedByRole: doc.uploadedByRole, sharedWithCp: doc.sharedWithCp,
      sharedWithCustomer: doc.sharedWithCustomer, createdAt: doc.createdAt.toISOString(),
    }});
  },

  // POST /:builderId/deals/:dealId/documents — add deal doc + optionally share
  addDealDocument: async (req: Request, res: Response) => {
    const { builderId, dealId } = req.params;
    const { name, docType, fileUrl, sharedWithCp, sharedWithCustomer } = req.body;
    if (!name) return res.status(400).json({ ok: false, message: 'name is required' });
    const doc = await prisma.dealDocument.create({
      data: {
        dealId: Number(dealId),
        name,
        docType: docType ?? 'Other',
        fileUrl: fileUrl ?? null,
        uploadedByRole: 'builder',
        sharedWithCp:       sharedWithCp ?? false,
        sharedWithCustomer: sharedWithCustomer ?? false,
      },
    });
    const deal = await prisma.deal.findUnique({
      where: { id: Number(dealId) },
      include: { cp: { select: { userId: true } }, project: { select: { name: true } } },
    });
    // Fan out (bell + SSE + opt-in WhatsApp) to whichever parties the doc is shared with.
    const addDocProject = (deal?.project as any)?.name ?? 'your deal';
    const addDocTargets: ('cp' | 'customer')[] = [
      ...(sharedWithCp ? ['cp' as const] : []),
      ...(sharedWithCustomer ? ['customer' as const] : []),
    ];
    if (addDocTargets.length) {
      await notifyDealParties(Number(dealId), {
        type: 'deal_doc',
        title: 'Document Shared',
        message: `Builder shared "${name}" for ${addDocProject}.`,
        to: addDocTargets,
        link: { cp: '/cp/leads', customer: '/customer/journey' },
        whatsappTemplate: 'deal_document_shared',
      }).catch(() => {});
    }
    res.json({ ok: true, data: doc });
  },

  // PATCH /:builderId/deals/:dealId/documents/:docId/share — update sharing flags
  shareDealDocument: async (req: Request, res: Response) => {
    const { dealId, docId } = req.params;
    const { sharedWithCp, sharedWithCustomer } = req.body;
    try {
      const doc = await prisma.dealDocument.update({
        where: { id: Number(docId), dealId: Number(dealId) },
        data: {
          ...(sharedWithCp         !== undefined ? { sharedWithCp }         : {}),
          ...(sharedWithCustomer   !== undefined ? { sharedWithCustomer }   : {}),
        },
      });
      res.json({ ok: true, data: doc });
    } catch {
      res.status(404).json({ ok: false, message: 'Document not found' });
    }
  },

  // POST /:builderId/deals/:dealId/messages — builder sends message to CP in deal thread
  sendDealMessage: async (req: Request, res: Response) => {
    const { builderId, dealId } = req.params;
    const { message } = req.body;
    // recipientRole picks the private thread: builder↔customer or builder↔cp. Defaults
    // to cp to preserve the legacy behaviour of older callers that omit it.
    const recipientRole: 'customer' | 'cp' = req.body.recipientRole === 'customer' ? 'customer' : 'cp';
    if (!message?.trim()) return res.status(400).json({ ok: false, message: 'message is required' });
    const builder = await prisma.builder.findUnique({
      where: { id: Number(builderId) },
      select: { userId: true, user: { select: { fullName: true } } },
    });
    if (!builder) return res.status(404).json({ ok: false, message: 'Builder not found' });
    const msg = await prisma.dealMessage.create({
      data: {
        dealId:     Number(dealId),
        senderId:   builder.userId,
        senderName: (builder.user as any)?.fullName ?? 'Builder',
        senderRole: 'builder',
        threadKey:  threadKey('builder', recipientRole),
        message,
      },
    });
    await notifyDealParties(Number(dealId), {
      type: 'deal_message',
      title: 'New message from Builder',
      message: message.substring(0, 80),
      to: [recipientRole],
      link: { cp: '/cp/leads', customer: '/customer/conversations' },
      whatsappTemplate: 'deal_new_message',
    }).catch(() => {});
    res.json({ ok: true, data: msg });
  },

  // PATCH /:builderId/deals/:dealId/payment-schedule — set payment schedule
  setPaymentSchedule: async (req: Request, res: Response) => {
    const { builderId, dealId } = req.params;
    const { schedule } = req.body;
    try {
      const updated = await prisma.deal.update({
        where: { id: Number(dealId), builderId: Number(builderId) },
        data:  { paymentSchedule: schedule },
      });
      res.json({ ok: true, data: { id: updated.id, paymentSchedule: updated.paymentSchedule } });
    } catch {
      res.status(404).json({ ok: false, message: 'Deal not found' });
    }
  },

  // PATCH /:builderId/deals/:dealId/assign-cp — builder links a CP (by userId) to a deal
  assignCPToDeal: async (req: Request, res: Response) => {
    const { builderId, dealId } = req.params;
    const { cpUserId } = req.body; // the CP's auth user id
    try {
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
        where: { id: Number(dealId), builderId: Number(builderId) },
        data:  { cpId },
        include: { project: { select: { name: true } } },
      });
      if (cpId) {
        const assignedProject = (updated.project as any)?.name ?? 'a project';
        await notifyDealParties(updated.id, {
          type: 'deal_assigned',
          title: 'Deal Assigned',
          message: `You have been assigned to the deal for ${assignedProject}.`,
          to: ['cp'],
          link: { cp: '/cp/leads' },
          whatsappTemplate: 'deal_stage_update',
          whatsappVars: ({ name }) => [name, assignedProject, 'Assigned to you'],
        }).catch(() => {});
      }
      res.json({ ok: true, data: { id: updated.id, cpId: updated.cpId } });
    } catch {
      res.status(404).json({ ok: false, message: 'Deal not found' });
    }
  },

  // PATCH /customer/deals/:dealId/confirm — customer confirms acceptance
  confirmCustomerDeal: async (req: Request, res: Response) => {
    const { dealId } = req.params;
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ ok: false, message: 'phone is required' });
    const customer = await prisma.user.findUnique({ where: { phone } });
    if (!customer) return res.status(404).json({ ok: false, message: 'Customer not found' });
    try {
      const updated = await prisma.deal.update({
        where: { id: Number(dealId), customerId: customer.id },
        data:  { customerConfirmed: true, status: 'Agreement' },
        include: { builder: { select: { userId: true } }, project: { select: { name: true } } },
      });
      const confirmProject = (updated.project as any)?.name ?? 'your project';
      await notifyDealParties(updated.id, {
        type: 'deal_confirmed',
        title: 'Customer Confirmed Deal',
        message: `Customer confirmed the deal for ${confirmProject}.`,
        to: ['builder'],
        link: { builder: '/builder/deals' },
        whatsappTemplate: 'deal_stage_update',
        whatsappVars: ({ name }) => [name, confirmProject, 'Customer confirmed'],
      }).catch(() => {});
      res.json({ ok: true, data: { id: updated.id, status: updated.status } });
    } catch {
      res.status(404).json({ ok: false, message: 'Deal not found or not authorized' });
    }
  },

  // PATCH /customer/deals/:dealId/accept-negotiation — customer accepts the negotiated pricing & terms,
  // moving the deal forward from Negotiation to Agreement
  acceptNegotiation: async (req: Request, res: Response) => {
    const { dealId } = req.params;
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ ok: false, message: 'phone is required' });
    const customer = await prisma.user.findUnique({ where: { phone } });
    if (!customer) return res.status(404).json({ ok: false, message: 'Customer not found' });
    try {
      const deal = await prisma.deal.findUnique({ where: { id: Number(dealId), customerId: customer.id }, select: { status: true } });
      if (!deal) return res.status(404).json({ ok: false, message: 'Deal not found or not authorized' });
      if (deal.status !== 'Negotiation') {
        return res.status(400).json({ ok: false, message: 'This deal is not currently in the negotiation stage' });
      }
      const updated = await prisma.deal.update({
        where: { id: Number(dealId), customerId: customer.id },
        data:  { status: 'Agreement' },
        include: { builder: { select: { userId: true } }, cp: { select: { userId: true } }, project: { select: { name: true } } },
      });
      const projectName = (updated.project as any)?.name ?? 'your project';
      await notifyDealParties(updated.id, {
        type: 'deal_agreed',
        notifType: 'success',
        title: 'Negotiation Accepted',
        message: `${customer.fullName ?? 'Customer'} accepted the negotiated terms for ${projectName}. The deal has moved to Agreement.`,
        to: ['builder', 'cp'],
        link: { builder: '/builder/deals', cp: '/cp/leads' },
        whatsappTemplate: 'deal_stage_update',
        whatsappVars: ({ name }) => [name, projectName, 'Agreement'],
      }).catch(() => {});
      res.json({ ok: true, data: { id: updated.id, status: updated.status } });
    } catch {
      res.status(404).json({ ok: false, message: 'Deal not found or not authorized' });
    }
  },

  // POST /customer/deals/:dealId/signed-agreement — customer uploads & submits the signed agreement to the builder
  uploadSignedAgreement: async (req: Request, res: Response) => {
    const { dealId } = req.params;
    const { phone } = req.body;
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!phone) return res.status(400).json({ ok: false, message: 'phone is required' });
    if (!file) return res.status(400).json({ ok: false, message: 'No file uploaded' });
    const customer = await prisma.user.findUnique({ where: { phone } });
    if (!customer) return res.status(404).json({ ok: false, message: 'Customer not found' });

    const deal = await prisma.deal.findUnique({
      where: { id: Number(dealId), customerId: customer.id },
      include: { builder: { select: { userId: true } }, cp: { select: { userId: true } }, project: { select: { name: true } } },
    });
    if (!deal) return res.status(404).json({ ok: false, message: 'Deal not found or not authorized' });

    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/deal-docs/${file.filename}`;
    const doc = await prisma.dealDocument.create({
      data: {
        dealId:             deal.id,
        name:               file.originalname,
        docType:            'Signed Agreement',
        fileUrl,
        uploadedByRole:     'customer',
        sharedWithCp:       true,
        sharedWithCustomer: true,
      },
    });

    const signedProject = (deal.project as any)?.name ?? 'your project';
    await notifyDealParties(deal.id, {
      type: 'deal_doc',
      notifType: 'success',
      title: 'Signed Agreement Received',
      message: `${customer.fullName ?? 'Customer'} submitted the signed agreement for ${signedProject}.`,
      to: ['builder', 'cp'],
      link: { builder: '/builder/deals', cp: '/cp/leads' },
      whatsappTemplate: 'deal_document_shared',
    }).catch(() => {});

    res.json({ ok: true, data: {
      id: doc.id, name: doc.name, docType: doc.docType, fileUrl: doc.fileUrl,
      uploadedByRole: doc.uploadedByRole, createdAt: doc.createdAt.toISOString(),
    }});
  },

  // PATCH /:builderId/deals/:dealId/accept-agreement — builder accepts the customer's signed agreement, moving the deal to Pending Booking
  acceptSignedAgreement: async (req: Request, res: Response) => {
    const { builderId, dealId } = req.params;
    try {
      const deal = await prisma.deal.findUnique({
        where: { id: Number(dealId), builderId: Number(builderId) },
        include: {
          customer: { select: { userId: true, fullName: true } },
          cp:       { select: { userId: true } },
          project:  { select: { name: true } },
          dealDocuments: { select: { docType: true, uploadedByRole: true } },
        },
      });
      if (!deal) return res.status(404).json({ ok: false, message: 'Deal not found' });
      if (deal.status !== 'Agreement') {
        return res.status(400).json({ ok: false, message: 'This deal is not currently in the agreement stage' });
      }
      const hasSignedAgreement = deal.dealDocuments.some(d => d.docType === 'Signed Agreement' && d.uploadedByRole === 'customer');
      if (!hasSignedAgreement) {
        return res.status(400).json({ ok: false, message: 'No signed agreement has been submitted by the customer yet' });
      }

      const updated = await prisma.deal.update({
        where: { id: Number(dealId), builderId: Number(builderId) },
        data:  { status: 'Pending Booking' },
      });

      const acceptProject = (deal.project as any)?.name ?? 'your project';
      await notifyDealParties(updated.id, {
        type: 'deal_agreed',
        notifType: 'success',
        title: 'Agreement Accepted',
        message: `The signed agreement for ${acceptProject} was accepted — the deal is now Pending Booking.`,
        to: ['customer', 'cp'],
        link: { customer: '/customer/journey', cp: '/cp/leads' },
        whatsappTemplate: 'deal_stage_update',
        whatsappVars: ({ name }) => [name, acceptProject, 'Pending Booking'],
      }).catch(() => {});

      res.json({ ok: true, data: { id: updated.id, status: updated.status } });
    } catch {
      res.status(404).json({ ok: false, message: 'Deal not found' });
    }
  },

  // PATCH /:builderId/deals/:dealId/mark-sold — Phase 9 (disbursement/registration):
  // mark the customer's unit SOLD in the project's unit matrix and close the deal.
  // Completes the customer journey and activates the interior-vendor step.
  markDealSold: async (req: Request, res: Response) => {
    const { builderId, dealId } = req.params;
    const { unitId } = req.body as { unitId?: string };
    try {
      const deal = await prisma.deal.findUnique({
        where: { id: Number(dealId), builderId: Number(builderId) },
        include: { project: { select: { id: true, name: true, unitMatrix: true } } },
      });
      if (!deal) return res.status(404).json({ ok: false, message: 'Deal not found' });

      // Resolve the unit: explicit override, else the customer's latest shortlist for this project.
      let targetUnitId = unitId;
      if (!targetUnitId) {
        const sl = await prisma.unitShortlist.findFirst({
          where: { customerId: deal.customerId, projectId: deal.projectId },
          orderBy: { id: 'desc' },
        });
        targetUnitId = sl?.unitId;
      }

      // Mark that unit Sold in the matrix (when it can be located).
      let unitMarked: string | null = null;
      const matrix = (deal.project as any)?.unitMatrix;
      if (targetUnitId && Array.isArray(matrix)) {
        const updatedMatrix = matrix.map((u: any) => {
          if (String(u.id) === String(targetUnitId)) { unitMarked = String(u.id); return { ...u, status: 'Sold' }; }
          return u;
        });
        if (unitMarked) await prisma.project.update({ where: { id: deal.projectId }, data: { unitMatrix: updatedMatrix } });
      }

      // Close the deal — registration done.
      const updated = await prisma.deal.update({ where: { id: deal.id }, data: { status: 'Closed' } });

      // Notify customer + CP — journey completes, interior-vendor activates.
      await notifyDealParties(deal.id, {
        type: 'notification', notifType: 'success',
        title: 'Registration Complete 🎉',
        message: `Your unit at ${(deal.project as any)?.name ?? 'the project'} is registered. Welcome home!`,
        to: ['customer', 'cp'],
        link: { customer: '/customer/journey', cp: '/cp/leads' },
      }).catch(() => {});

      res.json({ ok: true, data: { status: updated.status, unitMarkedSold: unitMarked } });
    } catch {
      res.status(404).json({ ok: false, message: 'Deal not found' });
    }
  },

  // POST /customer/deals/:dealId/messages — customer messages the builder or CP on a deal
  sendCustomerDealMessage: async (req: Request, res: Response) => {
    const { dealId } = req.params;
    const { phone, recipientRole, message } = req.body;
    if (!phone) return res.status(400).json({ ok: false, message: 'phone is required' });
    if (!message?.trim()) return res.status(400).json({ ok: false, message: 'message is required' });
    if (!['builder', 'cp'].includes(recipientRole)) {
      return res.status(400).json({ ok: false, message: 'recipientRole must be "builder" or "cp"' });
    }
    const customer = await prisma.user.findUnique({ where: { phone } });
    if (!customer) return res.status(404).json({ ok: false, message: 'Customer not found' });

    const deal = await prisma.deal.findUnique({
      where: { id: Number(dealId), customerId: customer.id },
      include: {
        builder: { select: { userId: true } },
        cp:      { select: { userId: true } },
        project: { select: { name: true } },
      },
    });
    if (!deal) return res.status(404).json({ ok: false, message: 'Deal not found or not authorized' });

    const custMsgProject = (deal.project as any)?.name ?? 'your project';
    if (recipientRole === 'cp' && !deal.cp) {
      return res.status(400).json({ ok: false, message: 'No channel partner is assigned to this deal yet' });
    }

    const msg = await prisma.dealMessage.create({
      data: {
        dealId:     deal.id,
        senderId:   customer.id,
        senderName: customer.fullName ?? 'Customer',
        senderRole: 'customer',
        threadKey:  threadKey('customer', recipientRole),
        message,
      },
    });

    await notifyDealParties(deal.id, {
      type: 'deal_message',
      title: 'New message from customer',
      message: `${customer.fullName ?? 'Customer'} sent a message about ${custMsgProject}.`,
      to: [recipientRole as 'builder' | 'cp'],
      link: { builder: '/builder/deals', cp: '/cp/leads' },
      whatsappTemplate: 'deal_new_message',
    }).catch(() => {});

    res.json({ ok: true, data: msg });
  },

  // POST /customer/pricing-requests — customer asks the builder for a pricing quote on a shortlisted unit
  requestPricing: async (req: Request, res: Response) => {
    const { builderId, projectId, customerPhone, unitId, note } = req.body;
    if (!builderId || !projectId || !customerPhone || !unitId) {
      return res.status(400).json({ ok: false, message: 'Missing required fields' });
    }
    const customer = await prisma.user.findUnique({ where: { phone: customerPhone } });
    if (!customer) return res.status(404).json({ ok: false, message: 'Customer not found' });

    const builder = await prisma.builder.findUnique({ where: { id: Number(builderId) }, select: { userId: true } });
    if (!builder) return res.status(404).json({ ok: false, message: 'Builder not found' });

    const project = await prisma.project.findUnique({ where: { id: Number(projectId) }, select: { name: true } });
    const projectName = project?.name ?? 'a project';
    const customerName = customer.fullName ?? 'A customer';
    const requestNote = (note?.trim() as string | undefined) || `Please share a pricing quote for Unit ${unitId}.`;

    const builderMsg = `${customerName} requested pricing for Unit ${unitId} in ${projectName}. "${requestNote}"`;
    await prisma.notification.create({ data: { userId: builder.userId, title: 'Pricing Request', message: builderMsg, type: 'info', link: '/builder/leads' } });
    channelManager.publish(`user:${builder.userId}`, { type: 'pricing_request', title: 'Pricing Request', message: builderMsg, city: '', timestamp: new Date().toISOString(), link: '/builder/leads' });

    const shortlist = await prisma.unitShortlist.findFirst({
      where: { customerId: customer.id, projectId: Number(projectId), unitId },
      select: { cpId: true },
    });
    if (shortlist?.cpId) {
      const cp = await prisma.channelPartner.findUnique({ where: { id: shortlist.cpId }, select: { userId: true } });
      if (cp) {
        const cpMsg = `${customerName} requested pricing for Unit ${unitId} in ${projectName}.`;
        await prisma.notification.create({ data: { userId: cp.userId, title: 'Pricing Request', message: cpMsg, type: 'info', link: '/cp/leads' } });
        channelManager.publish(`user:${cp.userId}`, { type: 'pricing_request', title: 'Pricing Request', message: cpMsg, city: '', timestamp: new Date().toISOString(), link: '/cp/leads' });
      }
    }

    res.json({ ok: true, data: { sent: true } });
  },

  // POST /portal/customer/applications — customer submits a home-loan application (Phase 7).
  // Creates a LoanCase on the customer's deal; mirrors createBuilderLoan but is
  // customer-initiated and resolves the deal by phone when builder/project aren't supplied.
  createCustomerLoanApplication: async (req: Request, res: Response) => {
    const { builderId, projectId, customerName, customerPhone, customerEmail, loanAmount, propertyValue, employmentType, tenureMonths } = req.body;
    if (!customerPhone || !loanAmount) {
      return res.status(400).json({ ok: false, message: 'customerPhone and loanAmount are required' });
    }

    let customer = await prisma.user.findUnique({ where: { phone: customerPhone } });
    if (!customer) {
      customer = await prisma.user.create({ data: { phone: customerPhone, fullName: customerName ?? 'Customer', email: customerEmail ?? null, role: 'CUSTOMER' } });
    }

    // Prefer the deal matching builder+project; otherwise the customer's most recent deal.
    let deal = (builderId && projectId)
      ? await prisma.deal.findFirst({ where: { builderId: Number(builderId), customerId: customer.id, projectId: Number(projectId) } })
      : null;
    if (!deal) deal = await prisma.deal.findFirst({ where: { customerId: customer.id }, orderBy: { createdAt: 'desc' } });
    if (!deal && builderId && projectId) {
      deal = await prisma.deal.create({ data: { builderId: Number(builderId), customerId: customer.id, projectId: Number(projectId), status: 'Interested Loan Required' } });
    }
    if (!deal) return res.status(400).json({ ok: false, message: 'No deal found to attach this loan application to' });

    const existing = await prisma.loanCase.findUnique({ where: { dealId: deal.id } });
    if (existing) return res.json({ ok: true, data: { id: existing.id, alreadyExists: true } });

    const loanCase = await prisma.loanCase.create({
      data: {
        dealId: deal.id, customerId: customer.id, projectId: deal.projectId,
        loanAmount: Number(loanAmount), propertyValue: Number(propertyValue ?? loanAmount),
        employmentType: employmentType ?? null, tenureMonths: tenureMonths ? Number(tenureMonths) : null,
        status: 'Applied',
      },
    });
    await prisma.loanNote.create({
      data: {
        loanCaseId: loanCase.id, type: 'loan_initiated', sender: customer.fullName ?? 'Customer', senderRole: 'customer',
        content: `Loan application submitted — ₹${Number(loanAmount).toLocaleString('en-IN')}${tenureMonths ? `, ${Math.round(Number(tenureMonths) / 12)} yr tenure` : ''}`,
      },
    });

    // Notify builder + CP (bell + SSE + opt-in WhatsApp).
    await notifyDealParties(deal.id, {
      type: 'notification', notifType: 'info', title: 'Loan Application Submitted',
      message: `${customer.fullName ?? 'Customer'} applied for a home loan — ₹${(Number(loanAmount) / 100000).toFixed(1)}L.`,
      to: ['builder', 'cp'], link: { builder: '/builder/deals', cp: '/cp/leads' },
    }).catch(() => {});

    res.json({ ok: true, data: { id: loanCase.id } });
  },
};
