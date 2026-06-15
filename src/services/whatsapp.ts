// ─── WhatsApp sender (Meta WhatsApp Cloud API) ──────────────────────────────────
//
// Env-gated and OFF by default: with no WHATSAPP_TOKEN / WHATSAPP_PHONE_ID it logs
// the intended message and no-ops, so dev and CI are unaffected. It is invoked from
// the single fan-out point in services/dealNotify.ts, so enabling it lights up
// WhatsApp for every deal event at once.
//
// To enable in production:
//   1. Create a Meta WhatsApp Business app → permanent WHATSAPP_TOKEN + WHATSAPP_PHONE_ID
//   2. Get the templates below approved in Meta Business Manager
//   3. Set the env vars; run `npx prisma db push` for User.whatsappOptIn
//
// Alternatives (India): AiSensy / Gupshup / Twilio WhatsApp — each is a single HTTPS
// POST; swap the request body below.

const WA_TOKEN = process.env.WHATSAPP_TOKEN;
const WA_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const WA_LANG = process.env.WHATSAPP_LANG || 'en';
const WA_VERSION = process.env.WHATSAPP_API_VERSION || 'v21.0';

export const WHATSAPP_ENABLED = Boolean(WA_TOKEN && WA_PHONE_ID);

// Event type → approved template name. Approve these in Meta Business Manager.
export const WHATSAPP_TEMPLATES: Record<string, string> = {
  deal_stage_update: 'deal_stage_update',
  deal_doc: 'deal_document_shared',
  deal_message: 'deal_new_message',
};

// Login/signup OTP template. Must be an *authentication*-category template
// (create in Meta Business Manager → "Authentication" → copy-code button);
// Meta rejects OTP content in utility/marketing templates.
const WA_OTP_TEMPLATE = process.env.WHATSAPP_OTP_TEMPLATE || 'dealio_otp';

/**
 * Send a one-time passcode via the approved authentication template.
 * Auth templates require the code in both the body and the copy-code URL
 * button, so this builds its own component payload rather than reusing
 * sendWhatsApp. Returns ok=false instead of throwing so the caller can
 * tell the user the code was not delivered.
 */
export async function sendWhatsAppOtp(toPhone: string, code: string): Promise<{ ok: boolean; detail?: string }> {
  if (!WHATSAPP_ENABLED) {
    console.log(`[WhatsApp:disabled] OTP for ${toPhone}: ${code}`);
    return { ok: false, detail: 'WhatsApp is not configured' };
  }

  const to = toPhone.replace(/[^\d]/g, '');
  if (!to) return { ok: false, detail: 'Invalid destination number' };

  try {
    const res = await fetch(`https://graph.facebook.com/${WA_VERSION}/${WA_PHONE_ID}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${WA_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: WA_OTP_TEMPLATE,
          language: { code: WA_LANG },
          components: [
            { type: 'body', parameters: [{ type: 'text', text: code }] },
            { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
          ],
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error(`[WhatsApp] OTP send failed (${res.status}) → ${to}: ${detail}`);
      return { ok: false, detail: `WhatsApp API error ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    console.error('[WhatsApp] network error:', (err as Error).message);
    return { ok: false, detail: 'Network error reaching WhatsApp' };
  }
}

/**
 * Send a templated WhatsApp message. Body params fill the template's {{1}}, {{2}}…
 * Safe to call unconditionally — no-ops (with a log) when not configured.
 */
export async function sendWhatsApp(
  toPhone: string,
  templateName: string,
  bodyParams: string[],
): Promise<void> {
  if (!WHATSAPP_ENABLED) {
    console.log(`[WhatsApp:disabled] → ${toPhone} [${templateName}] ${bodyParams.join(' | ')}`);
    return;
  }

  // Meta expects digits only, country code included, no '+' or spaces.
  const to = toPhone.replace(/[^\d]/g, '');
  if (!to) return;

  try {
    const res = await fetch(`https://graph.facebook.com/${WA_VERSION}/${WA_PHONE_ID}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${WA_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: WA_LANG },
          components: bodyParams.length
            ? [{ type: 'body', parameters: bodyParams.map((text) => ({ type: 'text', text })) }]
            : [],
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error(`[WhatsApp] send failed (${res.status}) → ${to}: ${detail}`);
    }
  } catch (err) {
    console.error('[WhatsApp] network error:', (err as Error).message);
  }
}
