// Outbound SMS for OTP delivery. Configure exactly one provider via env:
//
//   Twilio:  TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
//            TWILIO_FROM (an E.164 sender number, or a Messaging Service SID starting with "MG")
//   MSG91:   MSG91_AUTH_KEY, MSG91_TEMPLATE_ID (a DLT-approved OTP template id)
//
// Optional SMS_PROVIDER=twilio|msg91 forces the choice when both sets are present.
// When no provider is configured, authService falls back to the console mock.

type Provider = 'twilio' | 'msg91';

function twilioReady(): boolean {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
}

function msg91Ready(): boolean {
  return !!(process.env.MSG91_AUTH_KEY && process.env.MSG91_TEMPLATE_ID);
}

function activeProvider(): Provider | null {
  const forced = process.env.SMS_PROVIDER?.toLowerCase();
  if (forced === 'twilio') return twilioReady() ? 'twilio' : null;
  if (forced === 'msg91') return msg91Ready() ? 'msg91' : null;
  if (twilioReady()) return 'twilio';
  if (msg91Ready()) return 'msg91';
  return null;
}

export const smsProviderConfigured = (): boolean => activeProvider() !== null;

export async function sendOtpSms(e164Phone: string, otp: string): Promise<void> {
  const provider = activeProvider();
  if (!provider) throw new Error('No SMS provider configured');
  if (provider === 'twilio') return sendViaTwilio(e164Phone, otp);
  return sendViaMsg91(e164Phone, otp);
}

async function sendViaTwilio(to: string, otp: string): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const from = process.env.TWILIO_FROM!;
  const body = new URLSearchParams({
    To: to,
    Body: `Your Dealio verification code is ${otp}. It expires in 5 minutes.`,
  });
  body.set(from.startsWith('MG') ? 'MessagingServiceSid' : 'From', from);

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`Twilio responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}

async function sendViaMsg91(to: string, otp: string): Promise<void> {
  // MSG91 expects the number without "+", e.g. 919876543210
  const params = new URLSearchParams({
    template_id: process.env.MSG91_TEMPLATE_ID!,
    mobile: to.replace(/\D/g, ''),
    otp,
    otp_expiry: '5',
  });

  const res = await fetch(`https://control.msg91.com/api/v5/otp?${params}`, {
    method: 'POST',
    headers: { authkey: process.env.MSG91_AUTH_KEY!, 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`MSG91 responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  // MSG91 reports some failures as 200 + { type: 'error' }
  const json = (await res.json().catch(() => null)) as { type?: string; message?: string } | null;
  if (json?.type === 'error') {
    throw new Error(`MSG91 send failed: ${json.message ?? 'unknown error'}`);
  }
}
