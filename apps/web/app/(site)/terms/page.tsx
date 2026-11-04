import type { Metadata } from 'next';
import { ProsePage } from '@/components/prose-page';

export const metadata: Metadata = { title: 'Terms of service' };

// DRAFT: to be reviewed before launch.
export default function TermsPage() {
  return (
    <ProsePage title="Terms of service" updated="draft, not yet in force">
      <p>
        <strong>Draft.</strong> These terms are a working draft and will be reviewed before the
        service launches.
      </p>
      <h2>1. The service</h2>
      <p>
        ipx provides an API that returns information associated with IP addresses, such as an
        approximate location, network operator, time zone and risk signals. Access is free within
        the published limits; paid plans raise the monthly quota.
      </p>
      <h2>2. Accuracy</h2>
      <p>
        IP geolocation is approximate. An IP address shows where a network is registered or routed,
        not where a person or device is. Results may be wrong or out of date. Do not use the service
        for legal, emergency, safety or compliance decisions, or as the only basis for blocking or
        allowing access. The service is provided "as is", without warranty of any kind.
      </p>
      <h2>3. Acceptable use</h2>
      <ul>
        <li>Stay within the limits of your plan and do not try to work around them.</li>
        <li>Do not use the API to rebuild, export or resell the underlying databases.</li>
        <li>Keep your API keys secret. You are responsible for requests made with them.</li>
        <li>Do not use the service for unlawful purposes or to harm others.</li>
      </ul>
      <p>We may suspend keys or accounts that break these rules or put the service at risk.</p>
      <h2>4. Accounts and plans</h2>
      <p>
        You need a valid email address to create an account. Paid plans renew monthly until
        cancelled. Quotas reset at the start of each calendar month (UTC) and do not carry over.
      </p>
      <h2>5. Liability</h2>
      <p>
        To the extent allowed by law, we are not liable for indirect or consequential losses, or for
        decisions made using results from the service. Our total liability is limited to the fees
        you paid in the three months before the claim.
      </p>
      <h2>6. Changes</h2>
      <p>
        We may change these terms. Material changes will be announced by email or on this page at
        least 30 days before they apply.
      </p>
      <h2>7. Data sources</h2>
      <p>
        Results include data from third parties under their licenses; see the{' '}
        <a href="/credits">credits</a>.
      </p>
    </ProsePage>
  );
}
