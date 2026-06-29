import { Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { authService } from '../services/authService';
import prisma from '../utils/prisma';
import { channelManager } from '../services/channelManager';
import { issueSession } from '../services/sessionService';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dealio-secret-key-12345';

// Referral code format: CP-FIRSTNAME-USERID  (e.g. CP-JOHN-42)
async function processReferral(newUserId: number, newUserRole: string, referralCode: string) {
  const parts = referralCode.trim().split('-');
  const referringUserId = parseInt(parts[parts.length - 1] ?? '');
  if (isNaN(referringUserId) || referringUserId === newUserId) return;

  const referringCp = await prisma.channelPartner.findUnique({ where: { userId: referringUserId } });
  if (!referringCp) return;

  // If new user is a CP, persist the referral relationship
  if (newUserRole?.toUpperCase() === 'CP') {
    let newCp = await prisma.channelPartner.findUnique({ where: { userId: newUserId } });
    if (!newCp) {
      await prisma.channelPartner.create({ data: { userId: newUserId, referredById: referringCp.id } });
    } else if (!newCp.referredById) {
      await prisma.channelPartner.update({ where: { id: newCp.id }, data: { referredById: referringCp.id } });
    }
  }

  const newUser = await prisma.user.findUnique({ where: { id: newUserId }, select: { fullName: true } });
  const newUserName = newUser?.fullName ?? 'Someone';

  const title   = 'New Referral Joined!';
  const message = `${newUserName} joined Dealio using your referral code.`;
  await prisma.notification.create({
    data: { userId: referringCp.userId, title, message, type: 'success', link: '/cp/referral' },
  });
  channelManager.publish(`user:${referringCp.userId}`, {
    type: 'notification', title, message, city: '', timestamp: new Date().toISOString(), link: '/cp/referral',
  });
}

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
  || process.env.VITE_GOOGLE_CLIENT_ID
  || '1013744675613-5spva6h3eflij6vvofvjor875iiq9s63.apps.googleusercontent.com';

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// Digits with optional +, spaces, dashes, parens; 6-15 digits total (E.164 caps at 15).
// Validates without normalizing — phones are stored/looked up as entered.
function isValidPhone(phone: unknown): phone is string {
  if (typeof phone !== 'string') return false;
  const trimmed = phone.trim();
  if (!/^[+0-9 ()-]+$/.test(trimmed)) return false;
  const digits = trimmed.replace(/\D/g, '');
  return digits.length >= 6 && digits.length <= 15;
}

function isValidOtp(otp: unknown): otp is string {
  return typeof otp === 'string' && /^\d{6}$/.test(otp.trim());
}

// Optional; defaults to +91 in authService when absent
function isValidCountryCode(cc: unknown): boolean {
  return cc === undefined || cc === null || (typeof cc === 'string' && /^\+?\d{1,4}$/.test(cc.trim()));
}

async function handleSendOtp(req: Request, res: Response, opts?: { requireExistingAccount?: boolean }) {
  const { phone, countryCode } = req.body;
  if (!isValidPhone(phone)) {
    res.status(400).json({ ok: false, message: 'A valid phone number is required' });
    return;
  }
  if (!isValidCountryCode(countryCode)) {
    res.status(400).json({ ok: false, message: 'Invalid country code' });
    return;
  }
  // For login, verify the number is registered *before* sending a code, so the
  // user learns there's no account when they enter the number — not after going
  // through the whole OTP round-trip. (Matches loginVerifyOtp's existing check.)
  if (opts?.requireExistingAccount) {
    const existing = await prisma.user.findUnique({ where: { phone: phone.trim() }, select: { id: true } });
    if (!existing) {
      res.status(404).json({ ok: false, message: 'No account found for this number. Please sign up first.' });
      return;
    }
  }
  const result = await authService.sendOtp(phone.trim(), {
    countryCode: typeof countryCode === 'string' ? countryCode.trim() : undefined,
    ip: req.ip,
  });
  if (!result.success) {
    res.status(result.status).json({ ok: false, message: result.message });
    return;
  }
  res.json({ ok: true, message: result.message, data: result });
}

const KNOWN_ROLES = new Set(['BUILDER', 'CP', 'CUSTOMER', 'BANK', 'VENDOR', 'ADMIN', 'NRI', 'LANDOWNER']);

export const authController = {
  loginSendOtp: (req: Request, res: Response) => handleSendOtp(req, res, { requireExistingAccount: true }),

  loginVerifyOtp: async (req: Request, res: Response) => {
    const { phone, otp } = req.body;
    if (!isValidPhone(phone)) {
      res.status(400).json({ ok: false, message: 'A valid phone number is required' });
      return;
    }
    if (!isValidOtp(otp)) {
      res.status(400).json({ ok: false, message: 'A valid 6-digit OTP is required' });
      return;
    }
    const result = await authService.verifyOtp(phone.trim(), otp.trim(), undefined, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    }, true);
    if (result.success) {
      res.json({ ok: true, data: result.data });
    } else {
      res.status(400).json({ ok: false, message: result.message });
    }
  },

  signupSendOtp: (req: Request, res: Response) => handleSendOtp(req, res),

  signupVerifyOtp: async (req: Request, res: Response) => {
    const { phone, otp, fullName, role, referralCode } = req.body;
    if (!isValidPhone(phone)) {
      res.status(400).json({ ok: false, message: 'A valid phone number is required' });
      return;
    }
    if (!isValidOtp(otp)) {
      res.status(400).json({ ok: false, message: 'A valid 6-digit OTP is required' });
      return;
    }
    if (role !== undefined && !KNOWN_ROLES.has(String(role).toUpperCase())) {
      res.status(400).json({ ok: false, message: 'Unknown role' });
      return;
    }
    if (String(role).toUpperCase() === 'ADMIN' && process.env.NODE_ENV === 'production') {
      res.status(403).json({ ok: false, message: 'Admin accounts cannot be self-registered' });
      return;
    }
    const isNewUser = !(await prisma.user.findUnique({ where: { phone: phone.trim() }, select: { id: true } }));
    const result = await authService.verifyOtp(phone.trim(), otp.trim(), { fullName, role }, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    if (result.success) {
      if (isNewUser && referralCode) {
        processReferral(result.data!.user.id, role, referralCode).catch(err =>
          console.error('[referral] processReferral error:', err)
        );
      }
      res.json({ ok: true, data: result.data });
    } else {
      res.status(400).json({ ok: false, message: result.message });
    }
  },

  googleAuth: async (req: Request, res: Response) => {
    console.log('[googleAuth] hit — body keys:', Object.keys(req.body));
    const { idToken, role, referralCode } = req.body;

    if (!idToken) {
      res.status(400).json({ ok: false, message: 'Google ID token is required' });
      return;
    }

    let googleEmail: string;
    let googleName: string;
    let googleSub: string;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: GOOGLE_CLIENT_ID,
      });
      const p = ticket.getPayload();
      if (!p || !p.email) throw new Error('Empty token payload');
      googleEmail = p.email;
      googleName  = (p.name || p.email.split('@')[0]) as string;
      googleSub   = (p.sub  || String(Date.now())) as string;
    } catch (err) {
      console.error('[googleAuth] token verification failed:', err);
      res.status(401).json({ ok: false, message: 'Invalid Google token', detail: err instanceof Error ? err.message : String(err) });
      return;
    }

    const normalizedRole = (role || 'CUSTOMER').toUpperCase();
    console.log('[googleAuth] verified email:', googleEmail, 'role:', normalizedRole);

    try {
      // Find or create user by email
      let user = await prisma.user.findUnique({ where: { email: googleEmail } });

      const isNewUser = !user;
      if (!user) {
        user = await prisma.user.create({
          data: {
            email:    googleEmail,
            fullName: googleName,
            phone:    `google-${googleSub}`,   // placeholder — phone required by schema
            role:     normalizedRole,
          },
        });

        // Auto-create Builder profile if needed
        if (user.role === 'BUILDER') {
          await prisma.builder.create({ data: { userId: user.id } });
        }

        if (referralCode) {
          processReferral(user.id, normalizedRole, referralCode).catch(err =>
            console.error('[referral] processReferral error:', err)
          );
        }
      } else if (role) {
        // Update role on explicit signup
        user = await prisma.user.update({
          where: { id: user.id },
          data: { role: normalizedRole },
        });
      }

      const { token, expiresIn } = await issueSession(
        { id: user.id, phone: user.phone, role: user.role, fullName: user.fullName },
        { userAgent: req.headers['user-agent'], ip: req.ip }
      );

      console.log('[googleAuth] success for user id:', user.id);
      res.json({
        ok: true,
        data: {
          accessToken: token,
          refreshToken: token,
          expiresIn,
          user: {
            id:       user.id,
            fullName: user.fullName ?? googleName,
            email:    user.email,
            phone:    user.phone,
            role:     user.role,
          },
        },
      });
    } catch (dbErr) {
      console.error('[googleAuth] DB error:', dbErr);
      res.status(500).json({ ok: false, message: 'Internal server error during Google sign-in' });
    }
  },
};