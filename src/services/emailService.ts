import nodemailer from 'nodemailer';

function createTransport() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT ?? '587');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) return null;

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

export interface EmailRecipient {
  email: string;
  name: string;
}

export async function sendCalendarInvite(opts: {
  to: EmailRecipient[];
  subject: string;
  htmlBody: string;
  icsContent: string;
  filename: string;
}): Promise<void> {
  const transport = createTransport();
  if (!transport) {
    // SMTP not configured — log and skip silently so the rest of the flow is unaffected
    console.warn('[emailService] SMTP not configured — skipping calendar invite email');
    return;
  }

  const from = process.env.SMTP_FROM ?? process.env.SMTP_USER ?? 'noreply@dealio.com';

  const toAddresses = opts.to
    .filter(r => r.email && !r.email.startsWith('google-'))  // skip placeholder Google OAuth phones
    .map(r => `"${r.name}" <${r.email}>`)
    .join(', ');

  if (!toAddresses) return;

  await transport.sendMail({
    from,
    to: toAddresses,
    subject: opts.subject,
    html: opts.htmlBody,
    alternatives: [
      {
        contentType: 'text/calendar; charset=utf-8; method=REQUEST',
        content: opts.icsContent,
      },
    ],
    attachments: [
      {
        filename: opts.filename,
        content: opts.icsContent,
        contentType: 'application/ics',
      },
    ],
  });
}

export async function sendVerificationEmail(toEmail: string, token: string, name?: string) {
  const transport = createTransport();
  if (!transport) {
    console.warn('[emailService] SMTP not configured — skipping verification email');
    return;
  }

  const from = process.env.SMTP_FROM ?? process.env.SMTP_USER ?? 'noreply@dealio.com';
  const frontend = process.env.FRONTEND_URL ?? process.env.FRONTEND_API_URL ?? '';
  const verifyUrl = frontend ? `${frontend.replace(/\/$/, '')}/verify-email?token=${token}` : '';
  const html = `
    <p>Hi ${name ?? 'there'},</p>
    <p>Please verify your email address by clicking the link below:</p>
    <p><a href="${verifyUrl}">${verifyUrl || token}</a></p>
    <p>If the link does not work, use this token: <strong>${token}</strong></p>
    <p>This link expires in 24 hours.</p>
    <p>Thanks,<br/>Dealio Team</p>
  `;

  await transport.sendMail({
    from,
    to: toEmail,
    subject: 'Verify your email for Dealio',
    html,
  });
}
