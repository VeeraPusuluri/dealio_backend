import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { cpController } from '../controllers/cpController';
import { requireAuth } from '../middleware/auth';

const cpDocDir = path.join(process.cwd(), 'uploads', 'cp-docs');
if (!fs.existsSync(cpDocDir)) fs.mkdirSync(cpDocDir, { recursive: true });

const uniqueName = (_req: any, file: Express.Multer.File, cb: (e: Error | null, name: string) => void) => {
  const ext = path.extname(file.originalname);
  cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
};

const uploadDoc = multer({
  storage: multer.diskStorage({ destination: (_r, _f, cb) => cb(null, cpDocDir), filename: uniqueName }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only images and PDFs are allowed'));
  },
});

const router = Router();

// Share links
router.post('/:cpUserId/projects/:projectId/share-link', requireAuth, cpController.getOrCreateShareLink);

// Contacts
router.get('/:cpUserId/contacts', requireAuth, cpController.getContacts);
router.post('/:cpUserId/contacts', requireAuth, cpController.addContact);
router.patch('/:cpUserId/contacts/:contactId', requireAuth, cpController.updateContact);
router.delete('/:cpUserId/contacts/:contactId', requireAuth, cpController.deleteContact);

// Profile
router.get('/:cpUserId/profile', requireAuth, cpController.getProfile);
router.patch('/:cpUserId/profile', requireAuth, cpController.updateProfile);

// Notifications — static paths before /:cpUserId to avoid param collision
router.get('/notifications/stream', requireAuth, cpController.streamNotifications);  // SSE
router.get('/notifications',        requireAuth, cpController.getNotifications);
router.patch('/notifications/read-all', requireAuth, cpController.markAllNotificationsRead);
router.patch('/notifications/:id/read', requireAuth, cpController.markNotificationRead);

// Phone verification
router.post('/verify-phone/send-otp', requireAuth, cpController.sendPhoneOtp);
router.post('/:cpUserId/verify-phone', requireAuth, cpController.verifyPhone);

// Leads (deals referred by this CP)
router.get('/:cpUserId/leads',  requireAuth, cpController.getCPLeads);
router.post('/:cpUserId/leads', requireAuth, cpController.createCPLead);

// Commissions
router.get('/:cpUserId/commissions', requireAuth, cpController.getCommissions);

// Deal detail for CP
router.get('/:cpUserId/deals/:dealId',          requireAuth, cpController.getCPDeal);
router.patch('/:cpUserId/deals/:dealId/agree',  requireAuth, cpController.agreeDeal);
router.post('/:cpUserId/deals/:dealId/messages',requireAuth, cpController.sendCPDealMessage);

// Meetings
router.get('/:cpUserId/meetings', requireAuth, cpController.getCPMeetings);
router.patch('/:cpUserId/meetings/:meetingId/notes', requireAuth, cpController.addMeetingNote);

// Due today (follow-ups + call-log callbacks)
router.get('/:cpUserId/due-today', requireAuth, cpController.getDueToday);

// Follow-ups
router.get('/:cpUserId/follow-ups',           requireAuth, cpController.getFollowUps);
router.post('/:cpUserId/follow-ups',           requireAuth, cpController.createFollowUp);
router.patch('/:cpUserId/follow-ups/:id/done', requireAuth, cpController.markFollowUpDone);

// Call logs
router.get('/:cpUserId/call-logs',  requireAuth, cpController.getCallLogs);
router.post('/:cpUserId/call-logs', requireAuth, cpController.createCallLog);

// Document upload
router.post('/:cpUserId/documents', requireAuth, uploadDoc.single('file'), cpController.uploadDocument);

export default router;