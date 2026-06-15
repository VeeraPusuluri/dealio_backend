"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authController_1 = require("../controllers/authController");
const router = (0, express_1.Router)();
router.post('/login/phone/send-otp', authController_1.authController.loginSendOtp);
router.post('/login/phone/verify-otp', authController_1.authController.loginVerifyOtp);
router.post('/signup/phone/send-otp', authController_1.authController.signupSendOtp);
router.post('/signup/phone/verify-otp', authController_1.authController.signupVerifyOtp);
exports.default = router;
//# sourceMappingURL=authRoutes.js.map