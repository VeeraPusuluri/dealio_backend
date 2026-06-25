import { Request, Response } from 'express';
import crypto from 'crypto';

// Meta WhatsApp Cloud API webhook.
//
//   GET  /api/whatsapp/webhook  — one-time verification handshake (Meta sends
//        hub.mode/hub.verify_token/hub.challenge; we echo the challenge back
//        only when the token matches WHATSAPP_VERIFY_TOKEN).
//   POST /api/whatsapp/webhook  — inbound messages + message-status callbacks.
//        The payload signature is checked against WHATSAPP_APP_SECRET using the
//        raw request body, so this route must be mounted with a raw body parser.
//
// See app.ts: the route is registered BEFORE express.json() so req.body is the
// untouched Buffer needed for the HMAC check.

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const APP_SECRET = process.env.WHATSAPP_APP_SECRET;

function verify(req: Request, res: Response): void {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (!VERIFY_TOKEN) {
    console.error('[WhatsApp] WHATSAPP_VERIFY_TOKEN is not set — cannot verify webhook');
    res.sendStatus(500);
    return;
  }
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[WhatsApp] webhook verified');
    res.status(200).send(typeof challenge === 'string' ? challenge : '');
    return;
  }
  console.warn('[WhatsApp] webhook verification failed (mode/token mismatch)');
  res.sendStatus(403);
}

function signatureValid(rawBody: Buffer, header: string | undefined): boolean {
  if (!APP_SECRET) {
    // No secret configured: skip verification but warn (dev only — set it in prod).
    console.warn('[WhatsApp] WHATSAPP_APP_SECRET not set — skipping signature check');
    return true;
  }
  if (!header) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(rawBody).digest('hex');
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function receive(req: Request, res: Response): void {
  const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');

  if (!signatureValid(rawBody, req.get('x-hub-signature-256'))) {
    console.warn('[WhatsApp] invalid webhook signature — rejecting');
    res.sendStatus(401);
    return;
  }

  // Acknowledge immediately; Meta retries on non-2xx or slow responses.
  res.sendStatus(200);

  let payload: any;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    console.warn('[WhatsApp] webhook body was not valid JSON');
    return;
  }

  // Shape: { object: 'whatsapp_business_account', entry: [{ changes: [{ value }] }] }
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value ?? {};
      for (const msg of value.messages ?? []) {
        console.log(`[WhatsApp] inbound message from ${msg.from} type=${msg.type}`);
        // TODO: route inbound messages (e.g. STOP/opt-out, support replies) here.
      }
      for (const status of value.statuses ?? []) {
        console.log(`[WhatsApp] status ${status.status} for message ${status.id}`);
        // TODO: persist delivery/read receipts if needed.
      }
    }
  }
}

export const whatsappWebhook = { verify, receive };
