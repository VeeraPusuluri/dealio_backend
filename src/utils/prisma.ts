import { PrismaClient } from '@prisma/client';

const base = new PrismaClient();

/**
 * Every persisted `Notification` also fires an FCM push (best-effort). Doing it
 * here via a client extension means all notification sites — the deal fan-out and
 * every ad-hoc controller — deliver a push automatically, with no per-call wiring.
 */
const prisma = base.$extends({
  query: {
    notification: {
      async create({ args, query }) {
        const result = await query(args);
        const data = args.data as
          | { userId?: number; title?: string; message?: string; link?: string | null }
          | undefined;
        if (data?.userId && data.title) {
          // Lazy require avoids a circular import (pushService imports this client).
          // Fire-and-forget: a push must never block or break the DB write.
          try {
            const { sendPushToUser } = require('../services/pushService');
            sendPushToUser(data.userId, {
              title: data.title,
              body: data.message ?? '',
              link: data.link ?? undefined,
            }).catch(() => {});
          } catch {
            /* push module unavailable — ignore */
          }
        }
        return result;
      },
    },
  },
});

export default prisma;
