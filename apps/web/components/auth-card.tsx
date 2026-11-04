import type { ReactNode } from 'react';
import { Card } from './ui';

export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16">
      <Card>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-fd-muted-foreground">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </Card>
    </main>
  );
}
