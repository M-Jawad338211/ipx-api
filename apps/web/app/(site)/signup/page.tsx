import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth-card';
import { SignUpForm } from '@/components/auth-forms';
import { currentUser } from '@/server/session';

export const metadata: Metadata = { title: 'Create an account' };

export default async function SignUpPage() {
  if (await currentUser()) redirect('/dashboard');
  return (
    <AuthCard
      title="Create your account"
      subtitle="Free plan: 10,000 lookups per month. No card needed."
    >
      <SignUpForm />
    </AuthCard>
  );
}
