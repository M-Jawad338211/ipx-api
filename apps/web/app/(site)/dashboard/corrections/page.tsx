import { COUNTRY_NAMES } from '@ipx/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Button, Card, cx } from '@/components/ui';
import { reviewCorrectionAction } from '@/server/actions';
import { isAdmin, listCorrections, type CorrectionStatus } from '@/server/corrections';
import { getDb } from '@/server/db';
import { requireUser } from '@/server/session';

export const metadata: Metadata = { title: 'Corrections' };

const TABS: CorrectionStatus[] = ['new', 'accepted', 'rejected'];

export default async function CorrectionsPage(props: PageProps<'/dashboard/corrections'>) {
  const user = await requireUser();
  if (!isAdmin(user.email)) notFound();
  const search = await props.searchParams;
  const status = TABS.find((t) => t === search.status) ?? 'new';
  const rows = await listCorrections(getDb(), status);

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Location corrections</h1>
          <p className="text-sm text-fd-muted-foreground">
            Accepted corrections are applied to lookups within a few minutes.
          </p>
        </div>
        <Link href="/dashboard" className="text-sm underline underline-offset-4">
          Back to the dashboard
        </Link>
      </div>
      <nav className="flex gap-2">
        {TABS.map((tab) => (
          <Link
            key={tab}
            href={`/dashboard/corrections?status=${tab}`}
            className={cx(
              'rounded-lg px-3 py-1.5 text-sm capitalize',
              tab === status
                ? 'bg-fd-primary text-fd-primary-foreground'
                : 'text-fd-muted-foreground hover:bg-fd-accent',
            )}
          >
            {tab}
          </Link>
        ))}
      </nav>
      {rows.length === 0 && <p className="text-sm text-fd-muted-foreground">Nothing here.</p>}
      {rows.map((c) => (
        <Card key={c.id} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <code className="font-mono text-sm">{c.ip}</code>
            <span className="text-xs text-fd-muted-foreground">
              {c.createdAt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
            </span>
          </div>
          <p className="text-sm">
            <span className="text-fd-muted-foreground">Suggested: </span>
            {[c.city, c.region, COUNTRY_NAMES[c.countryCode] ?? c.countryCode]
              .filter(Boolean)
              .join(', ')}
          </p>
          {c.note && <p className="text-sm text-fd-muted-foreground">“{c.note}”</p>}
          {c.email && <p className="text-xs text-fd-muted-foreground">Contact: {c.email}</p>}
          {c.network && <Badge>Applies to {c.network}</Badge>}
          {status === 'new' && (
            <div className="flex flex-wrap gap-2">
              <form action={reviewCorrectionAction} className="flex gap-2">
                <input type="hidden" name="id" value={c.id} />
                <input type="hidden" name="decision" value="accepted" />
                <select
                  name="scope"
                  aria-label="Apply to"
                  className="rounded-lg border border-fd-border bg-fd-background px-2 text-sm"
                  defaultValue="ip"
                >
                  <option value="ip">This IP only</option>
                  <option value="network">{c.ip.includes(':') ? 'Its /48' : 'Its /24'}</option>
                </select>
                <Button type="submit" className="px-3 py-1.5">
                  Accept
                </Button>
              </form>
              <form action={reviewCorrectionAction}>
                <input type="hidden" name="id" value={c.id} />
                <input type="hidden" name="decision" value="rejected" />
                <Button type="submit" variant="danger" className="px-3 py-1.5">
                  Reject
                </Button>
              </form>
            </div>
          )}
        </Card>
      ))}
    </main>
  );
}
