import { env } from './env.ts';

/** Sends the verification code through Resend's REST API (no SDK needed). */
export async function sendVerificationEmail(to: string, code: string): Promise<void> {
  const apiKey = env.resendApiKey;
  if (!apiKey) throw new Error('RESEND_API_KEY is not set');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.emailFrom,
      to: [to],
      subject: `${code} is your ipx confirmation code`,
      text: [
        `Your ipx confirmation code is ${code}.`,
        '',
        'Enter it in the dashboard to confirm your email address. It expires in 10 minutes.',
        "If you didn't create an ipx account, you can ignore this email.",
      ].join('\n'),
      html: `<p>Your ipx confirmation code is:</p>
<p style="font-size:28px;font-weight:600;letter-spacing:6px;font-family:monospace">${code}</p>
<p>Enter it in the dashboard to confirm your email address. It expires in 10 minutes.</p>
<p style="color:#666">If you didn't create an ipx account, you can ignore this email.</p>`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`Resend answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}
