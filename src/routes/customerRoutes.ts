import { Router } from 'express';
import { customerController } from '../controllers/customerController';
import { requireAuth } from '../middleware/auth';

const router = Router();

// Public
router.get('/cities', customerController.getCities);
router.get('/projects', customerController.getProjects);
router.get('/projects/:id', customerController.getProject);
router.get('/cps', customerController.getAvailableCPs);

// Diagnostic (dev only)
router.get('/channels/stats', customerController.channelStats);

// Auth-protected
router.get('/subscribe', requireAuth, customerController.subscribeToCity);   // SSE
router.patch('/preferred-city', requireAuth, customerController.setPreferredCity);
router.patch('/profile', requireAuth, customerController.updateProfile);
router.get('/notifications', requireAuth, customerController.getNotifications);
router.patch('/notifications/read-all', requireAuth, customerController.markAllNotificationsRead);
router.patch('/notifications/:id/read', requireAuth, customerController.markNotificationRead);

export default router;