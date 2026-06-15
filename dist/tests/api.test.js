"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const app_1 = __importDefault(require("../app"));
describe('Health Check', () => {
    it('should return 200 and OK status', async () => {
        const res = await (0, supertest_1.default)(app_1.default).get('/api/health');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            status: 'OK',
            message: 'Dealio Backend is running'
        });
    });
});
describe('Auth API', () => {
    it('should request OTP', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/auth/login/phone/send-otp')
            .send({ phone: '1234567890' });
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
    });
    it('should verify OTP and return token', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/auth/login/phone/verify-otp')
            .send({ phone: '1234567890', otp: '123456' });
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.data.token).toBeDefined();
        expect(res.body.data.user).toBeDefined();
    });
});
//# sourceMappingURL=api.test.js.map