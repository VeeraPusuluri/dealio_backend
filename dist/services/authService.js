"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authService = exports.otps = exports.users = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const JWT_SECRET = process.env.JWT_SECRET || 'dealio-secret-key-12345';
// Mock DB for demonstration
exports.users = [];
exports.otps = {}; // phone -> otp
exports.authService = {
    sendOtp: (phone) => {
        const otp = '123456'; // Constant OTP for testing as requested/implied by "mock"
        exports.otps[phone] = otp;
        console.log(`[AuthService] OTP for ${phone}: ${otp}`);
        return { success: true, message: 'OTP sent' };
    },
    verifyOtp: (phone, otp, userData) => {
        if (exports.otps[phone] === otp) {
            delete exports.otps[phone];
            let user = exports.users.find(u => u.phone === phone);
            if (!user) {
                user = {
                    id: exports.users.length + 1,
                    phone,
                    name: userData?.fullName || 'User ' + phone.slice(-4),
                    role: userData?.role || 'CUSTOMER',
                    email: '',
                    createdAt: new Date().toISOString()
                };
                exports.users.push(user);
            }
            else if (userData?.fullName) {
                user.name = userData.fullName;
                if (userData.role)
                    user.role = userData.role;
            }
            const token = jsonwebtoken_1.default.sign({ id: user.id, phone: user.phone, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
            return {
                success: true,
                data: {
                    token,
                    user: {
                        id: user.id,
                        name: user.name,
                        phone: user.phone,
                        role: user.role,
                        email: user.email
                    }
                }
            };
        }
        return { success: false, message: 'Invalid OTP' };
    }
};
//# sourceMappingURL=authService.js.map