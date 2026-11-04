import { PLANS } from '@ipx/db';
import { Lock, LogOut, MailCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { CheckoutButton } from '@/components/checkout-button';
import { KeyPanel } from '@/components/key-panel';
import { Alert, Badge, Button, Card, LinkButton } from '@/components/ui';
import { UsageChart } from '@/components/usage-chart';
import { canUseFeatures, currentPlan, dailyUsage, listKeys, monthUsage } from '@/server/accounts';
import { logOutAction } from '@/server/actions';
import { paddleConfig } from '@/server/billing';
import { getDb } from '@/server/db';
import { env, publicApiUrl } from '@/server/env';
import { requireUser } from '@/server/session';

export const metadata: Metadata = { title: 'Dashboard' };

export default async function DashboardPage(props: PageProps<'/dashboard'>) {
  const user = await requireUser();
  const search = await props.searchParams;
  const db = getDb();
  const unlocked = canUseFeatures(user, env.verificationRequired);
  const [keys, plan, days, used] = await Promise.all([
    listKeys(db, user.id),
    currentPlan(db, user.id),
    dailyUsage(db, user.id, 30),
    monthUsage(db, user.id),
  ]);
  const paddle = paddleConfig();
  const share = Math.min(100, (used / plan.plan.monthlyQuota) * 100);

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-fd-muted-foreground">{user.email}</p>
        </div>
        <form action={logOutAction}>
          <Button type="submit" variant="ghost">
            <LogOut className="size-4" /> Log out
          </Button>
        </form>
      </div>

      {search.verified === '1' && (
        <Alert tone="success" title="Email confirmed. API keys are now available." />
      )}

      {!unlocked && (
        <Alert
          tone="warning"
          title="Confirm your email to access the features, like API keys."
          className="flex flex-wrap items-center justify-between gap-3"
        >
          <span className="block">
            Enter the 6-digit code we emailed to {user.email}, or request a new one. API keys work
            once your email is confirmed.
          </span>
          <LinkButton href="/verify" className="mt-3">
            <MailCheck className="size-4" /> Enter the code
          </LinkButton>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="font-medium">Usage</h2>
          <div className="mt-4">
            <UsageChart days={days} />
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Plan</h2>
            <Badge>{plan.plan.name}</Badge>
          </div>
          <p className="mt-4 text-2xl font-semibold">
            {used.toLocaleString('en-US')}
            <span className="text-base font-normal text-fd-muted-foreground">
              {' '}
              / {plan.plan.monthlyQuota.toLocaleString('en-US')}
            </span>
          </p>
          <p className="text-sm text-fd-muted-foreground">lookups this month (UTC)</p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-fd-muted">
            <div className="h-full rounded-full bg-fd-primary" style={{ width: `${share}%` }} />
          </div>
          {plan.status && plan.status !== 'active' && (
            <p className="mt-3 text-sm text-fd-muted-foreground">
              Subscription status: {plan.status}
            </p>
          )}
          <div className="mt-5 space-y-2">
            {paddle ? (
              PLANS.filter((p) => p.sortOrder > plan.plan.sortOrder && paddle.prices[p.id]).map(
                (p) => (
                  <CheckoutButton
                    key={p.id}
                    label={`Upgrade to ${p.name} (${p.monthlyQuota.toLocaleString('en-US')}/mo)`}
                    priceId={paddle.prices[p.id]!}
                    clientToken={paddle.clientToken}
                    environment={paddle.environment}
                    email={user.email}
                    userId={user.id}
                  />
                ),
              )
            ) : (
              <p className="text-sm text-fd-muted-foreground">
                Need more lookups?{' '}
                <a
                  href={`mailto:${env.contactEmail}`}
                  className="font-medium text-fd-foreground underline underline-offset-4"
                >
                  Contact us
                </a>{' '}
                about the Starter, Pro and Business plans.
              </p>
            )}
          </div>
        </Card>
      </div>

      <Card>
        <div className="flex items-center justify-between">
          <h2 className="font-medium">API keys</h2>
          <span className="text-sm text-fd-muted-foreground">
            Send as <code className="font-mono">Authorization: Bearer ipx_…</code>
          </span>
        </div>
        <div className="mt-4">
          {unlocked ? (
            <KeyPanel
              apiUrl={publicApiUrl}
              keys={keys.map((k) => ({
                id: k.id,
                name: k.name,
                prefix: k.prefix,
                createdAt: k.createdAt.toISOString(),
                lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
              }))}
            />
          ) : (
            <div className="flex items-center gap-3 rounded-lg border border-dashed border-fd-border p-6 text-sm text-fd-muted-foreground">
              <Lock className="size-5 shrink-0" />
              Confirm your email to create and use API keys.
            </div>
          )}
        </div>
      </Card>
    </main>
  );
}
