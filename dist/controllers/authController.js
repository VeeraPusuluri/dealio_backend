"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authController = void 0;
const express_1 = require("express");
const authService_1 = require("../services/authService");
exports.authController = {
    loginSendOtp: async (req, res) => {
        const { phone } = req.body;
        const result = authService_1.authService.sendOtp(phone);
        res.json({ ok: true, data: result });
    },
    loginVerifyOtp: async (req, res) => {
        const { phone, otp } = req.body;
        const result = authService_1.authService.verifyOtp(phone, otp);
        if (result.success) {
            res.json({ ok: true, data: result.data });
        }
        else {
            res.status(400).json({ ok: false, message: result.message });
        }
    },
    signupSendOtp: async (req, res) => {
        const { phone } = req.body;
        const result = authService_1.authService.sendOtp(phone);
        res.json({ ok: true, data: result });
    },
    signupVerifyOtp: async (req, res) => {
        const { phone, otp, fullName, role } = req.body;
        const result = authService_1.authService.verifyOtp(phone, otp, { fullName, role });
        if (result.success) {
            res.json({ ok: true, data: result.data });
        }
        else {
            res.status(400).json({ ok: false, message: result.message });
        }
    }
};
//# sourceMappingURL=authController.js.map