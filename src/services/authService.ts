import jwt from 'jsonwebtoken';
import { randomInt, timingSafeEqual } from 'crypto';
import prisma from '../utils/prisma';
import { sendOtpSms, smsProviderConfigured } from './smsService';
import { sendWhatsAppOtp, WHATSAPP_ENABLED } from './whatsapp';
import { otpStore } from './otpStore';
import { issueSession, DeviceInfo } from './sessionService';

const JWT_SECRET = process.env.JWT_SECRET || 'dealio-secret-key-12345';

const OTP_TTL_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;
const SEND_WINDOW_MS = 60 * 60 * 1000;
const MAX_SENDS_PER_PHONE = 5;   // per phone per hour
const MAX_SENDS_PER_IP = 15;     // per IP per hour
const MAX_VERIFY_ATTEMPTS = 5;

// OTP codes and send rate-limit counters live in `otpStore` (Redis when
// REDIS_URL is set, in-memory otherwise) so they survive restarts and are
// shared across instances. See services/otpStore.ts.

function maskPhone(e164: string): string {
  return e164.length <= 4 ? e164 : e164.slice(0, 3) + '*'.repeat(e164.length - 7) + e164.slice(-4);
}

function toE164(phone: string, countryCode?: string): string {
  if (phone.startsWith('+')) return '+' + phone.replace(/\D/g, '');
  const cc = (countryCode ?? '+91').replace(/\D/g, '') || '91';
  return `+${cc}${phone.replace(/\D/g, '')}`;
}

const isProduction = () => process.env.NODE_ENV === 'production';

export type SendOtpResult =
  | { success: true; message: string; maskedPhone: string; demoCode?: string }
  | { success: false; status: number; message: string };

export type VerifyOtpResult =
  | {
      success: true;
      data: {
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
        user: { id: number; fullName: string | null; phone: string | null; role: string; email: string | null };
      };
    }
  | { success: false; message: string; suspended?: boolean };

export const authService = {
  sendOtp: async (phone: string, opts?: { countryCode?: string | undefined; ip?: string | undefined }): Promise<SendOtpResult> => {
    const phoneKey = `phone:${phone}`;
    const ipKey = opts?.ip ? `ip:${opts.ip}` : null;

    const cooldown = await otpStore.cooldownRemainingMs(phoneKey);
    if (cooldown > 0) {
      const wait = Math.ceil(cooldown / 1000);
      return { success: false, status: 429, message: `Please wait ${wait}s before requesting another code.` };
    }
    if (await otpStore.sendCount(phoneKey) >= MAX_SENDS_PER_PHONE) {
      return { success: false, status: 429, message: 'Too many codes requested for this number. Please try again later.' };
    }
    if (ipKey && (await otpStore.sendCount(ipKey)) >= MAX_SENDS_PER_IP) {
      return { success: false, status: 429, message: 'Too many requests. Please try again later.' };
    }

    const code = randomInt(100000, 1000000).toString();
    const e164 = toE164(phone, opts?.countryCode);

    // Count the send and start the cooldown before delivery so failed provider
    // calls still consume quota (and can't be retried instantly).
    await otpStore.startCooldown(phoneKey, RESEND_COOLDOWN_MS);
    await otpStore.recordSend(phoneKey, SEND_WINDOW_MS);
    if (ipKey) await otpStore.recordSend(ipKey, SEND_WINDOW_MS);
    await otpStore.saveOtp(phone, code, OTP_TTL_MS);

    // Delivery preference: WhatsApp → SMS → console mock. A WhatsApp failure
    // (e.g. the number has no WhatsApp account or isn't in the allowed list) falls through to SMS when a
    // provider is configured. Only attempt WhatsApp for existing users who opted in.
    const userRecord = await prisma.user.findUnique({ where: { phone: e164 } });

    if (WHATSAPP_ENABLED && userRecord?.whatsappOptIn) {
      const wa = await sendWhatsAppOtp(e164, code);
      if (wa.ok) {
        console.log(`[AuthService] OTP sent via WhatsApp to ${maskPhone(e164)}`);
        return { success: true, message: 'Code sent on WhatsApp', maskedPhone: maskPhone(e164) };
      }
      console.error(`[AuthService] WhatsApp send failed for ${maskPhone(e164)}: ${wa.detail}`);
      // If no SMS provider is configured, allow a non-production demo fallback so devs can continue.
      if (!smsProviderConfigured()) {
        if (!isProduction()) {
          await otpStore.clearOtp(phone);
          return { success: true, message: 'OTP (dev demo)', maskedPhone: maskPhone(e164), demoCode: code };
        }
        await otpStore.clearOtp(phone);
        return { success: false, status: 502, message: 'Could not send the code on WhatsApp. Please try again.' };
      }
    }

    if (smsProviderConfigured()) {
      try {
        await sendOtpSms(e164, code);
      } catch (err) {
        await otpStore.clearOtp(phone);
        console.error(`[AuthService] SMS send failed for ${maskPhone(e164)}:`, err);
        return { success: false, status: 502, message: 'Could not send the verification code. Please try again.' };
      }
      console.log(`[AuthService] OTP sent via SMS to ${maskPhone(e164)}`);
      return { success: true, message: 'OTP sent', maskedPhone: maskPhone(e164) };
    }

    // Mock fallback: no SMS provider configured. The code is only logged —
    // and only echoed back to the client outside production.
    if (isProduction()) {
      console.warn('[AuthService] WARNING: no SMS provider configured in production — OTP visible in server logs only');
    }
    console.log(`[AuthService] OTP for ${phone}: ${code}`);
    return {
      success: true,
      message: 'OTP sent',
      maskedPhone: maskPhone(e164),
      ...(isProduction() ? {} : { demoCode: code }),
    };
  },

  verifyOtp: async (
    phone: string,
    otp: string,
    userData?: { fullName?: string; role?: string },
    device?: DeviceInfo,
    isLogin?: boolean
  ): Promise<VerifyOtpResult> => {
    // Dev/test convenience only: the legacy constant code keeps the demo-skip
    // flow and local testing working. Never accepted in production.
    const devBypass = !isProduction() && otp === '123456';

    if (!devBypass) {
      const entry = await otpStore.readOtp(phone);
      if (!entry) {
        return { success: false, message: 'Code expired or not requested. Please request a new code.' };
      }
      const attempts = await otpStore.bumpAttempts(phone);
      if (attempts > MAX_VERIFY_ATTEMPTS) {
        await otpStore.clearOtp(phone);
        return { success: false, message: 'Too many incorrect attempts. Please request a new code.' };
      }
      const expected = Buffer.from(entry.code);
      const provided = Buffer.from(otp);
      if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
        return { success: false, message: 'Invalid OTP' };
      }
    }
    await otpStore.clearOtp(phone);

    let user = await prisma.user.findUnique({
      where: { phone }
    });

    if (user && user.role.startsWith('SUSPENDED_')) {
      return { success: false, suspended: true, message: 'Account suspended. Please contact support.' };
    }

    if (!user) {
      if (isLogin) {
        return { success: false, message: 'No account found for this number. Please sign up first.' };
      }
      user = await prisma.user.create({
        data: {
          phone,
          fullName: userData?.fullName || 'User ' + phone.slice(-4),
          role: userData?.role || 'CUSTOMER',
        }
      });

      // If role is BUILDER, also create a Builder record
      if (user.role === 'BUILDER') {
        await prisma.builder.create({
          data: {
            userId: user.id
          }
        });
      }
    } else if (userData?.fullName) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          fullName: userData.fullName,
          role: userData.role || user.role
        }
      });
    }

    const { token, expiresIn } = await issueSession(
      { id: user.id, phone: user.phone, role: user.role, fullName: user.fullName },
      device
    );

    return {
      success: true,
      data: {
        accessToken: token,
        refreshToken: token,
        expiresIn,
        user: {
          id: user.id,
          fullName: user.fullName,
          phone: user.phone,
          role: user.role,
          email: user.email
        }
      }
    };
  }
};
