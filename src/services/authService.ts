import jwt from 'jsonwebtoken';
import { randomInt, timingSafeEqual } from 'crypto';
import prisma from '../utils/prisma';
import { sendOtpSms, smsProviderConfigured } from './smsService';
import { sendWhatsAppOtp, WHATSAPP_ENABLED } from './whatsapp';

const JWT_SECRET = process.env.JWT_SECRET || 'dealio-secret-key-12345';

const OTP_TTL_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;
const SEND_WINDOW_MS = 60 * 60 * 1000;
const MAX_SENDS_PER_PHONE = 5;   // per phone per hour
const MAX_SENDS_PER_IP = 15;     // per IP per hour
const MAX_VERIFY_ATTEMPTS = 5;

interface OtpEntry {
  code: string;
  expiresAt: number;
  attempts: number;
}

// Single-instance in-memory state. If the backend ever scales past one
// instance, both maps must move to shared storage (DB/Redis).
const otps = new Map<string, OtpEntry>();
const sendLog = new Map<string, number[]>(); // "phone:<n>" / "ip:<addr>" -> send timestamps

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of otps) if (entry.expiresAt < now) otps.delete(key);
  for (const [key, hits] of sendLog) {
    const recent = hits.filter(t => now - t < SEND_WINDOW_MS);
    if (recent.length === 0) sendLog.delete(key);
    else sendLog.set(key, recent);
  }
}, 10 * 60 * 1000).unref();

function recentHits(key: string, now: number): number[] {
  const hits = (sendLog.get(key) ?? []).filter(t => now - t < SEND_WINDOW_MS);
  sendLog.set(key, hits);
  return hits;
}

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
    const now = Date.now();

    const phoneHits = recentHits(`phone:${phone}`, now);
    const lastSend = phoneHits[phoneHits.length - 1];
    if (lastSend && now - lastSend < RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((RESEND_COOLDOWN_MS - (now - lastSend)) / 1000);
      return { success: false, status: 429, message: `Please wait ${wait}s before requesting another code.` };
    }
    if (phoneHits.length >= MAX_SENDS_PER_PHONE) {
      return { success: false, status: 429, message: 'Too many codes requested for this number. Please try again later.' };
    }
    const ipHits = opts?.ip ? recentHits(`ip:${opts.ip}`, now) : [];
    if (opts?.ip && ipHits.length >= MAX_SENDS_PER_IP) {
      return { success: false, status: 429, message: 'Too many requests. Please try again later.' };
    }

    const code = randomInt(100000, 1000000).toString();
    const e164 = toE164(phone, opts?.countryCode);

    // Count the send before delivery so failed provider calls still consume quota
    phoneHits.push(now);
    if (opts?.ip) ipHits.push(now);
    otps.set(phone, { code, expiresAt: now + OTP_TTL_MS, attempts: 0 });

    // Delivery preference: WhatsApp → SMS → console mock. A WhatsApp failure
    // (e.g. the number has no WhatsApp account) falls through to SMS when a
    // provider is configured.
    if (WHATSAPP_ENABLED) {
      const wa = await sendWhatsAppOtp(e164, code);
      if (wa.ok) {
        console.log(`[AuthService] OTP sent via WhatsApp to ${maskPhone(e164)}`);
        return { success: true, message: 'Code sent on WhatsApp', maskedPhone: maskPhone(e164) };
      }
      console.error(`[AuthService] WhatsApp send failed for ${maskPhone(e164)}: ${wa.detail}`);
      if (!smsProviderConfigured()) {
        otps.delete(phone);
        return { success: false, status: 502, message: 'Could not send the code on WhatsApp. Please try again.' };
      }
    }

    if (smsProviderConfigured()) {
      try {
        await sendOtpSms(e164, code);
      } catch (err) {
        otps.delete(phone);
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
    userData?: { fullName?: string; role?: string }
  ): Promise<VerifyOtpResult> => {
    const entry = otps.get(phone);

    // Dev/test convenience only: the legacy constant code keeps the demo-skip
    // flow and local testing working. Never accepted in production.
    const devBypass = !isProduction() && otp === '123456';

    if (!devBypass) {
      if (!entry || entry.expiresAt < Date.now()) {
        otps.delete(phone);
        return { success: false, message: 'Code expired or not requested. Please request a new code.' };
      }
      entry.attempts += 1;
      if (entry.attempts > MAX_VERIFY_ATTEMPTS) {
        otps.delete(phone);
        return { success: false, message: 'Too many incorrect attempts. Please request a new code.' };
      }
      const expected = Buffer.from(entry.code);
      const provided = Buffer.from(otp);
      if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
        return { success: false, message: 'Invalid OTP' };
      }
    }
    otps.delete(phone);

    let user = await prisma.user.findUnique({
      where: { phone }
    });

    if (user && user.role.startsWith('SUSPENDED_')) {
      return { success: false, suspended: true, message: 'Account suspended. Please contact support.' };
    }

    if (!user) {
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

    const token = jwt.sign(
      { id: user.id, phone: user.phone, role: user.role, name: user.fullName },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return {
      success: true,
      data: {
        accessToken: token,
        refreshToken: token,
        expiresIn: 7 * 24 * 60 * 60,
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
