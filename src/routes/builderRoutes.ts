import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { builderController } from '../controllers/builderController';
import { requireAuth } from '../middleware/auth';

const imageUploadDir   = path.join(process.cwd(), 'uploads', 'project-images');
const docUploadDir     = path.join(process.cwd(), 'uploads', 'project-docs');
const dealDocUploadDir = path.join(process.cwd(), 'uploads', 'deal-docs');
if (!fs.existsSync(imageUploadDir))   fs.mkdirSync(imageUploadDir,   { recursive: true });
if (!fs.existsSync(docUploadDir))     fs.mkdirSync(docUploadDir,     { recursive: true });
if (!fs.existsSync(dealDocUploadDir)) fs.mkdirSync(dealDocUploadDir, { recursive: true });

const uniqueName = (_req: any, file: Express.Multer.File, cb: (e: Error | null, name: string) => void) => {
  const ext = path.extname(file.originalname);
  cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
};

const upload = multer({
  storage: multer.diskStorage({ destination: (_r, _f, cb) => cb(null, imageUploadDir), filename: uniqueName }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

const uploadDoc = multer({
  storage: multer.diskStorage({ destination: (_r, _f, cb) => cb(null, docUploadDir), filename: uniqueName }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only images and PDFs are allowed'));
  },
});

const uploadDealDoc = multer({
  storage: multer.diskStorage({ destination: (_r, _f, cb) => cb(null, dealDocUploadDir), filename: uniqueName }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf',
                     'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only images, PDFs and Word docs are allowed'));
  },
});

const router = Router();

// Static routes MUST come before parameterised ones to avoid /:builderId swallowing them
router.post('/ensure', builderController.ensureBuilder);
router.get('/projects', builderController.getPublicProjects);
router.get('/builders', builderController.getPublicBuilders);
router.get('/resolve-maps-link', builderController.resolveMapsLink);

// Builder notifications
router.get('/notifications/stream', requireAuth, builderController.streamNotifications);  // SSE
router.get('/notifications', requireAuth, builderController.getBuilderNotifications);
router.patch('/notifications/read-all', requireAuth, builderController.markAllNotificationsRead);
router.patch('/notifications/:id/read', requireAuth, builderController.markNotificationRead);

// Customer SSE notification stream (shortlist responses, deal updates)
router.get('/customer/notifications/stream', requireAuth, builderController.streamNotifications);

// Customer-facing meeting booking (static — must be before /:builderId)
router.post('/customer/meetings', builderController.bookMeeting);
router.get('/customer/meetings', builderController.getMeetings);
router.get('/customer/booked-slots', builderController.getBookedSlots);
router.patch('/customer/meetings/:id/rating', builderController.rateCustomerMeeting);
router.get('/customer/deals', builderController.getCustomerDeals);
router.patch('/customer/deals/:dealId/confirm',                          builderController.confirmCustomerDeal);
router.patch('/customer/deals/:dealId/accept-negotiation',               builderController.acceptNegotiation);
router.post('/customer/deals/:dealId/signed-agreement', requireAuth, uploadDealDoc.single('file'), builderController.uploadSignedAgreement);
router.post('/customer/deals/:dealId/messages', requireAuth, builderController.sendCustomerDealMessage);
router.post('/customer/shortlist', builderController.createUnitShortlist);
router.get('/customer/shortlist', builderController.getCustomerShortlists);
router.post('/customer/pricing-requests', builderController.requestPricing);
router.post('/customer/applications', builderController.createCustomerLoanApplication);   // Phase 7 — customer home-loan application

// CP share link — public endpoints (no auth)
router.post('/projects/:projectId/leads/from-share', builderController.createLeadFromShare);
router.get('/share/:token', builderController.resolveShareToken);

// Parameterised builder routes
router.post('/:builderId/projects', builderController.createProject);
router.get('/:builderId/projects', builderController.getProjects);
router.get('/:builderId/projects/:projectId', builderController.getProject);
router.get('/:builderId/projects/:projectId/pdf', builderController.getProjectPdf);
router.patch('/:builderId/projects/:projectId', builderController.updateProject);
router.post('/:builderId/projects/:projectId/image', requireAuth, upload.single('file'), builderController.uploadProjectImage);
router.get('/:builderId/projects/:projectId/documents', builderController.getDocuments);
router.post('/:builderId/projects/:projectId/documents', requireAuth, uploadDoc.single('file'), builderController.uploadDocument);
router.get('/:builderId/meetings', builderController.getBuilderMeetings);
router.patch('/:builderId/meetings/:meetingId', builderController.updateMeetingStatus);
router.get('/:builderId/deals', builderController.getBuilderDeals);
router.patch('/:builderId/deals/:dealId/status', requireAuth, builderController.updateDealStatus);
router.patch('/:builderId/deals/:dealId/accept-agreement', requireAuth, builderController.acceptSignedAgreement);
router.patch('/:builderId/deals/:dealId/mark-sold', requireAuth, builderController.markDealSold);   // Phase 9 — mark unit SOLD + close
router.get('/:builderId/deals/:dealId',                                  builderController.getDeal);
router.post('/:builderId/deals/:dealId/documents',   requireAuth,        builderController.addDealDocument);
router.post('/:builderId/deals/:dealId/upload',      requireAuth, uploadDealDoc.single('file'), builderController.uploadDealDocument);
router.patch('/:builderId/deals/:dealId/documents/:docId/share', requireAuth, builderController.shareDealDocument);
router.post('/:builderId/deals/:dealId/messages',    requireAuth,        builderController.sendDealMessage);
router.patch('/:builderId/deals/:dealId/payment-schedule', requireAuth,  builderController.setPaymentSchedule);
router.patch('/:builderId/deals/:dealId/assign-cp',        requireAuth,  builderController.assignCPToDeal);
router.get('/:builderId/leads', requireAuth, builderController.getBuilderLeads);
router.patch('/:builderId/leads/:dealId/stage', requireAuth, builderController.updateLeadStage);
router.get('/:builderId/loans', requireAuth, builderController.getBuilderLoans);
router.post('/:builderId/loans', requireAuth, builderController.createBuilderLoan);
router.patch('/:builderId/loans/:id/status', requireAuth, builderController.updateLoanStatus);
router.post('/:builderId/loans/:id/notes', requireAuth, builderController.addLoanNote);
router.get('/:builderId/shortlists', requireAuth, builderController.getBuilderShortlists);
router.patch('/:builderId/shortlists/:id', requireAuth, builderController.respondToShortlist);
router.get('/:builderId/commissions', requireAuth, builderController.getBuilderCommissions);
router.patch('/:builderId/commissions/:dealId/release', requireAuth, builderController.releaseBuilderCommission);

// Broadcasts
router.get('/:builderId/broadcasts', requireAuth, builderController.getBroadcasts);
router.post('/:builderId/broadcasts', requireAuth, builderController.sendBroadcast);

// Project Updates
router.get('/:builderId/projects/:projectId/updates', requireAuth, builderController.getProjectUpdates);
router.post('/:builderId/projects/:projectId/updates', requireAuth, builderController.createProjectUpdate);
router.patch('/:builderId/projects/:projectId/updates/:updateId', requireAuth, builderController.editProjectUpdate);
router.delete('/:builderId/projects/:projectId/updates/:updateId', requireAuth, builderController.deleteProjectUpdate);

// Public: fetch updates visible to a role (no auth needed — CP/Customer portals call this)
router.get('/projects/:projectId/updates', builderController.getPublicProjectUpdates);

export default router;