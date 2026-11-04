import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth-card';
import { VerifyForm } from '@/components/auth-forms';
import { canUseFeatures } from '@/server/accounts';
import { env } from '@/server/env';
import { requireUser } from '@/server/session';

export const metadata: Metadata = { title: 'Confirm your email' };

export default async function VerifyPage() {
  const user = await requireUser();
  if (canUseFeatures(user, env.verificationRequired)) redirect('/dashboard');
  return (
    <AuthCard
      title="Confirm your email"
      subtitle={<Link href="/dashboard">Back to the dashboard</Link>}
    >
      <VerifyForm email={user.email} />
    </AuthCard>
  );
}
