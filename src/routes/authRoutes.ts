import { Router } from 'express';
import { authController } from '../controllers/authController';

const router = Router();

router.post('/login/phone/send-otp', authController.loginSendOtp);
router.post('/login/phone/verify-otp', authController.loginVerifyOtp);
router.post('/signup/phone/send-otp', authController.signupSendOtp);
router.post('/signup/phone/verify-otp', authController.signupVerifyOtp);
router.post('/google', authController.googleAuth);

export default router;
