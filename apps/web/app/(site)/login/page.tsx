import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth-card';
import { LogInForm } from '@/components/auth-forms';
import { currentUser } from '@/server/session';

export const metadata: Metadata = { title: 'Log in' };

export default async function LogInPage() {
  if (await currentUser()) redirect('/dashboard');
  return (
    <AuthCard title="Log in" subtitle="Manage your API keys and usage.">
      <LogInForm />
    </AuthCard>
  );
}
