import { COUNTRY_NAMES } from '@ipx/shared';
import type { Metadata } from 'next';
import { AuthCard } from '@/components/auth-card';
import { CorrectionForm } from '@/components/correction-form';
import { publicApiUrl } from '@/server/env';
import { turnstileEnabled, turnstileSiteKey } from '@/server/turnstile';

export const metadata: Metadata = { title: 'Report a wrong location' };

const COUNTRIES = Object.entries(COUNTRY_NAMES).sort((a, b) => a[1].localeCompare(b[1]));

export default async function CorrectPage(props: PageProps<'/correct'>) {
  const search = await props.searchParams;
  const ip = typeof search.ip === 'string' ? search.ip : null;
  return (
    <AuthCard
      title="Report a wrong location"
      subtitle="Tell us where an IP address really is. Every report is reviewed by hand."
    >
      <CorrectionForm
        apiUrl={publicApiUrl}
        initialIp={ip}
        countries={COUNTRIES}
        turnstileSiteKey={turnstileEnabled() ? turnstileSiteKey : null}
      />
    </AuthCard>
  );
}
