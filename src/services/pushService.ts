// ─── Firebase Cloud Messaging push delivery ─────────────────────────────────
//
// Sends FCM pushes to a user's registered device tokens. Initialized from a
// service-account JSON (path via FIREBASE_SERVICE_ACCOUNT_PATH, default
// ./firebase-service-account.json relative to the backend cwd). If the file is
// absent, push is disabled (a no-op) so the app still runs in environments that
// haven't been given the credential.

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getMessaging, Messaging } from 'firebase-admin/messaging';
import fs from 'fs';
import path from 'path';
import prisma from '../utils/prisma';

let messaging: Messaging | null = null;

(function initFirebaseAdmin() {
  // Credential source, in order: FIREBASE_SERVICE_ACCOUNT_JSON (raw JSON, e.g.
  // from SSM/.env on the server) → FIREBASE_SERVICE_ACCOUNT_PATH → default file.
  let sa: Record<string, unknown> | null = null;
  try {
    const jsonEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (jsonEnv && jsonEnv.trim().startsWith('{')) {
      sa = JSON.parse(jsonEnv);
    } else {
      const credPath =
        process.env.FIREBASE_SERVICE_ACCOUNT_PATH || path.join(process.cwd(), 'firebase-service-account.json');
      if (!fs.existsSync(credPath)) {
        console.warn(`[push] no service account (env or ${credPath}) — FCM push disabled`);
        return;
      }
      sa = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    }
    const app = getApps().length ? getApps()[0]! : initializeApp({ credential: cert(sa as any) });
    messaging = getMessaging(app);
    console.log(`[push] firebase-admin initialized (project ${(sa as any).project_id})`);
  } catch (err) {
    console.error('[push] failed to initialize firebase-admin:', err);
  }
})();

export function isPushEnabled(): boolean {
  return messaging !== null;
}

interface PushPayload {
  title: string;
  body: string;
  link?: string | undefined;
  data?: Record<string, string> | undefined;
}

/**
 * Sends an FCM push to every device token registered for a user. Best-effort:
 * returns delivery counts and prunes tokens Firebase reports as unregistered/invalid.
 * No-op (returns null) when push is disabled or the user has no tokens.
 */
export async function sendPushToUser(userId: number, payload: PushPayload) {
  if (!messaging) return null;
  const rows = await prisma.deviceToken.findMany({ where: { userId }, select: { token: true } });
  if (rows.length === 0) return null;
  const tokens = rows.map((r) => r.token);

  // FCM data values must all be strings.
  const data: Record<string, string> = { ...(payload.data ?? {}) };
  if (payload.link) data.link = payload.link;

  try {
    const resp = await messaging.sendEachForMulticast({
      tokens,
      notification: { title: payload.title, body: payload.body },
      data,
      android: { priority: 'high', notification: { channelId: 'dealio_default' } },
      apns: { payload: { aps: { sound: 'default' } } },
    });

    const invalid: string[] = [];
    resp.responses.forEach((r, i) => {
      const tok = tokens[i];
      if (!r.success && tok) {
        const code = r.error?.code ?? '';
        if (
          code.includes('registration-token-not-registered') ||
          code.includes('invalid-registration-token') ||
          code.includes('invalid-argument')
        ) {
          invalid.push(tok);
        }
      }
    });
    if (invalid.length) {
      await prisma.deviceToken.deleteMany({ where: { token: { in: invalid } } }).catch(() => {});
    }
    return { successCount: resp.successCount, failureCount: resp.failureCount, pruned: invalid.length };
  } catch (err) {
    console.error('[push] send failed:', err);
    return null;
  }
}
