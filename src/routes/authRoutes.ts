import { Router } from 'express';
import { authController } from '../controllers/authController';
import { sessionController } from '../controllers/sessionController';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.post('/login/phone/send-otp', authController.loginSendOtp);
router.post('/login/phone/verify-otp', authController.loginVerifyOtp);
router.post('/signup/phone/send-otp', authController.signupSendOtp);
router.post('/signup/phone/verify-otp', authController.signupVerifyOtp);
router.post('/google', authController.googleAuth);

// Device / session management (logged-in devices in Settings)
router.get('/sessions', requireAuth, sessionController.list);
router.delete('/sessions/:id', requireAuth, sessionController.revoke);
router.delete('/sessions', requireAuth, sessionController.revokeOthers);
router.post('/logout', requireAuth, sessionController.logout);

export default router;
