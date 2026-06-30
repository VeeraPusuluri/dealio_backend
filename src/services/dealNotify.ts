// ─── notifyDealParties — single fan-out point for deal events ───────────────────
//
// Resolves each party (builder / cp / customer) on a deal to their app userId +
// phone + WhatsApp opt-in, then performs ALL three deliveries in one place:
//   1. prisma.notification.create  → persisted bell notification (+ deep link)
//   2. channelManager.publish      → live SSE push to user:${userId}
//   3. sendWhatsApp                → opt-in + env-gated WhatsApp message
//
// Replaces the ~15 copy-pasted notify/publish blocks across the controllers.
// New events call this one function; new transports (push, email) are added here once.

import prisma from '../utils/prisma';
import { channelManager, ChannelEvent } from './channelManager';
import { sendWhatsApp } from './whatsapp';
import { sendPushToUser } from './pushService';

export type DealRole = 'builder' | 'cp' | 'customer';

interface Party {
  role: DealRole;
  userId: number;
  name: string;
  phone: string | null;
  whatsappOptIn: boolean;
}

export interface DealNotifyInput {
  /** SSE event type (see ChannelEvent['type']). */
  type: ChannelEvent['type'];
  title: string;
  message: string;
  /** Which parties on the deal to notify. */
  to: DealRole[];
  /** Per-role deep link for the bell / SSE payload. */
  link?: Partial<Record<DealRole, string>>;
  /** Stored notification severity. */
  notifType?: 'info' | 'success' | 'warning' | 'error';
  /** WhatsApp template name (omit to skip WhatsApp for this event). */
  whatsappTemplate?: string;
  /** Build the WhatsApp body params per recipient; defaults to [name, projectName]. */
  whatsappVars?: (ctx: { role: DealRole; name: string; projectName: string }) => string[];
}

/**
 * Notify the chosen parties on a deal across DB + SSE + WhatsApp.
 * Best-effort: individual delivery failures are swallowed so one channel can't
 * break the request that triggered the event.
 */
export async function notifyDealParties(dealId: number, ev: DealNotifyInput): Promise<void> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      customer: true,
      builder: { include: { user: true } },
      cp: { include: { user: true } },
      project: { select: { name: true } },
    },
  });
  if (!deal) return;

  const projectName = (deal.project as any)?.name ?? 'your deal';

  // whatsappOptIn is read defensively (cast) so this compiles before the Prisma
  // client is regenerated; it resolves to false until the column exists.
  const parties: Record<DealRole, Party | null> = {
    customer: deal.customer
      ? {
          role: 'customer',
          userId: deal.customer.id,
          name: deal.customer.fullName ?? 'Customer',
          phone: deal.customer.phone,
          whatsappOptIn: (deal.customer as any).whatsappOptIn ?? false,
        }
      : null,
    builder: deal.builder?.user
      ? {
          role: 'builder',
          userId: deal.builder.user.id,
          name: deal.builder.user.fullName ?? 'Builder',
          phone: deal.builder.user.phone,
          whatsappOptIn: (deal.builder.user as any).whatsappOptIn ?? false,
        }
      : null,
    cp: deal.cp?.user
      ? {
          role: 'cp',
          userId: deal.cp.user.id,
          name: deal.cp.user.fullName ?? 'Channel Partner',
          phone: deal.cp.user.phone,
          whatsappOptIn: (deal.cp.user as any).whatsappOptIn ?? false,
        }
      : null,
  };

  await Promise.all(
    ev.to.map(async (role) => {
      const party = parties[role];
      if (!party) return;
      const link = ev.link?.[role];

      // 1. Persisted per-user notification (link is nullable in the DB)
      const created = await prisma.notification
        .create({
          data: { userId: party.userId, title: ev.title, message: ev.message, type: ev.notifType ?? 'info', link: link ?? null },
        })
        .catch(() => null);

      // 2. Live SSE push to the user's personal channel, carrying the persisted
      // notification id so the client can dedupe the live event against the copy it
      // later hydrates from the DB. `link` is only set when present — ChannelEvent.link
      // is optional, so under exactOptionalPropertyTypes we omit it rather than pass undefined.
      channelManager.publish(`user:${party.userId}`, {
        type: ev.type,
        title: ev.title,
        message: ev.message,
        city: '',
        timestamp: new Date().toISOString(),
        ...(link ? { link } : {}),
        ...(created ? { notificationId: created.id } : {}),
        dealId,
      });

      // 3. WhatsApp — opt-in + env-gated (no-ops when disabled)
      if (party.whatsappOptIn && party.phone && ev.whatsappTemplate) {
        const vars = ev.whatsappVars
          ? ev.whatsappVars({ role, name: party.name, projectName })
          : [party.name, projectName];
        await sendWhatsApp(party.phone, ev.whatsappTemplate, vars);
      }

      // 4. FCM push to the party's registered devices (no-op when push disabled
      // or the user has no tokens). Best-effort — never breaks the event.
      await sendPushToUser(party.userId, {
        title: ev.title,
        body: ev.message,
        link,
        data: { type: ev.type, dealId: String(dealId) },
      }).catch(() => null);
    }),
  );
}
