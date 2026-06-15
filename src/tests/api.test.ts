import request from 'supertest';
import app from '../app';

describe('Health Check', () => {
  it('should return 200 and OK status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'OK',
      message: 'Dealio Backend is running'
    });
  });
});

describe('Auth API', () => {
  let demoCode: string;

  it('should reject a missing phone', async () => {
    const res = await request(app)
      .post('/api/auth/login/phone/send-otp')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('should request OTP and echo the code outside production', async () => {
    const res = await request(app)
      .post('/api/auth/login/phone/send-otp')
      .send({ phone: '1234567890', countryCode: '+91' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.demoCode).toMatch(/^\d{6}$/);
    demoCode = res.body.data.demoCode;
  });

  it('should rate-limit an immediate resend', async () => {
    const res = await request(app)
      .post('/api/auth/login/phone/send-otp')
      .send({ phone: '1234567890', countryCode: '+91' });

    expect(res.status).toBe(429);
    expect(res.body.ok).toBe(false);
  });

  it('should reject a wrong OTP', async () => {
    const res = await request(app)
      .post('/api/auth/login/phone/verify-otp')
      .send({ phone: '1234567890', otp: demoCode === '000000' ? '000001' : '000000' });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('should verify OTP and return token', async () => {
    const res = await request(app)
      .post('/api/auth/login/phone/verify-otp')
      .send({ phone: '1234567890', otp: demoCode });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.user).toBeDefined();
  });
});
