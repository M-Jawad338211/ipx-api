import { HomeLayout } from 'fumadocs-ui/layouts/home';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { baseOptions } from '@/lib/layout.shared';

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <HomeLayout {...baseOptions()}>
      <div className="flex flex-1 flex-col">{children}</div>
      <footer className="mt-16 border-t border-fd-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-6 py-8 text-sm text-fd-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            IP geolocation by{' '}
            <a href="https://db-ip.com" className="underline underline-offset-4">
              DB-IP
            </a>
            . Country and ASN data by{' '}
            <a href="https://ipinfo.io" className="underline underline-offset-4">
              IPinfo
            </a>
            .
          </p>
          <nav className="flex flex-wrap gap-4">
            <Link href="/docs">Docs</Link>
            {process.env.NEXT_PUBLIC_STATUS_URL && (
              <a href={process.env.NEXT_PUBLIC_STATUS_URL}>Status</a>
            )}
            <Link href="/correct">Report a wrong location</Link>
            <Link href="/credits">Credits</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
          </nav>
        </div>
      </footer>
    </HomeLayout>
  );
}
