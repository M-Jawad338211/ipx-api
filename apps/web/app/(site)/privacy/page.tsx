import type { Metadata } from 'next';
import { ProsePage } from '@/components/prose-page';

export const metadata: Metadata = { title: 'Privacy policy' };

// DRAFT: to be reviewed before launch.
export default function PrivacyPage() {
  return (
    <ProsePage title="Privacy policy" updated="draft, not yet in force">
      <p>
        <strong>Draft.</strong> This policy is a working draft and will be reviewed before the
        service launches.
      </p>
      <h2>What we process</h2>
      <ul>
        <li>
          <strong>Lookup requests.</strong> To answer a request we process the IP address you look
          up and the IP address the request comes from. IP addresses are personal data under the
          GDPR and UK GDPR.
        </li>
        <li>
          <strong>Account data.</strong> Your email address, a hash of your password, your API keys
          (stored as hashes), your plan and daily request counts per key.
        </li>
        <li>
          <strong>Billing data.</strong> Payments are handled by Paddle as merchant of record; we
          receive your subscription status, not your card details.
        </li>
      </ul>
      <h2>Retention of IP addresses</h2>
      <p>
        We do not store the IP addresses you look up. We do not keep per-request logs by default.
        Rate limiting keeps a counter per calling IP address in memory for at most two days. Server
        logs that may contain IP addresses (for example error logs) are deleted after 14 days.
      </p>
      <h2>What we do not do</h2>
      <p>We do not sell lookup data or logs, and we do not use them for advertising.</p>
      <h2>Processors</h2>
      <p>
        Hosting (Hetzner, EU), network and DDoS protection (Cloudflare), email delivery (Resend) and
        payments (Paddle). A data processing agreement is available for business customers on
        request.
      </p>
      <h2>Your rights</h2>
      <p>
        You can export or delete your account data at any time by contacting us. Deleting your
        account removes your keys and usage history.
      </p>
    </ProsePage>
  );
}
