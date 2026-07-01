import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { adminController } from '../controllers/adminController';

const router = Router();

// Public — no auth required (customer contact form)
router.post('/contact', adminController.submitContactRequest);

router.use(requireAuth);  // all routes below require auth

router.get('/stats',                          adminController.getStats);
router.get('/users',                          adminController.getUsers);
router.patch('/users/:userId/suspend',        adminController.suspendUser);
router.get('/builders',                       adminController.getBuilders);
router.get('/projects',                       adminController.getProjects);
router.patch('/projects/:projectId/featured', adminController.toggleProjectFeatured);
router.get('/cps',                            adminController.getCPs);
router.get('/cps/for-assignment',             adminController.getCPsForAssignment);
router.patch('/cps/:cpId/verify-doc',         adminController.verifyDocument);
router.patch('/cps/:cpId/tier',               adminController.updateCPTier);
router.get('/revenue',                        adminController.getRevenueStats);
router.get('/deals',                          adminController.getDeals);
router.patch('/deals/:dealId/milestone',      adminController.updateDealMilestone);
router.patch('/deals/:dealId/assign-cp',      adminController.assignCPToDeal);
router.get('/commissions',                    adminController.getCommissions);
router.get('/loan-cases',                     adminController.getLoanCases);
router.get('/loan-cases/:id',                 adminController.getLoanCase);
router.patch('/loan-cases/:id/status',        adminController.updateLoanCaseStatus);
router.post('/loan-cases/:id/notes',          adminController.addLoanCaseNote);
router.get('/meetings',                       adminController.getMeetings);
router.get('/contact',                        adminController.getContactRequests);
router.patch('/contact/:id/status',           adminController.updateContactStatus);
router.get('/deletion-requests',              adminController.getDeletionRequests);
router.patch('/deletion-requests/:id',        adminController.reviewDeletionRequest);

export default router;
