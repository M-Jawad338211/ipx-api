import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

/** Joins class names, skipping falsy values. */
export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-fd-primary text-fd-primary-foreground hover:opacity-90',
  secondary: 'border border-fd-border bg-fd-card text-fd-foreground hover:bg-fd-accent',
  ghost: 'text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-accent',
  danger: 'border border-red-500/40 text-red-600 hover:bg-red-500/10 dark:text-red-400',
};

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:pointer-events-none disabled:opacity-50';

export function Button({
  variant = 'primary',
  className,
  ...props
}: ComponentProps<'button'> & { variant?: Variant }) {
  return <button className={cx(BUTTON_BASE, VARIANTS[variant], className)} {...props} />;
}

export function LinkButton({
  variant = 'primary',
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={cx(BUTTON_BASE, VARIANTS[variant], className)} {...props} />;
}

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cx(
        'w-full rounded-lg border border-fd-border bg-fd-background px-3 py-2 text-sm outline-none transition placeholder:text-fd-muted-foreground focus:border-fd-primary focus:ring-2 focus:ring-fd-primary/20',
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return <label className={cx('mb-1.5 block text-sm font-medium', className)} {...props} />;
}

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cx('rounded-xl border border-fd-border bg-fd-card p-6 shadow-sm', className)}
      {...props}
    />
  );
}

export function Badge({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full border border-fd-border px-2.5 py-0.5 text-xs font-medium text-fd-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: 'info' | 'warning' | 'error' | 'success';
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const tones = {
    info: 'border-blue-500/30 bg-blue-500/5',
    warning: 'border-amber-500/40 bg-amber-500/10',
    error: 'border-red-500/40 bg-red-500/10',
    success: 'border-emerald-500/40 bg-emerald-500/10',
  };
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx('rounded-xl border p-4 text-sm', tones[tone], className)}
    >
      {title && <p className="font-medium">{title}</p>}
      {children && (
        <div className={cx(title ? 'mt-1' : '', 'text-fd-muted-foreground')}>{children}</div>
      )}
    </div>
  );
}

export function FieldError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">{children}</p>;
}
