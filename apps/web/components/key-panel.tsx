'use client';

import { Check, Copy, KeyRound } from 'lucide-react';
import { useActionState, useState } from 'react';
import { createKeyAction, revokeKeyAction, type KeyFormState } from '@/server/actions';
import { Alert, Button, FieldError, Input } from './ui';

export interface KeyRow {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      className="shrink-0 px-3"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

export function KeyPanel({ keys, apiUrl }: { keys: KeyRow[]; apiUrl: string }) {
  const [state, action, pending] = useActionState<KeyFormState, FormData>(createKeyAction, {});

  return (
    <div className="space-y-5">
      <form action={action} className="flex flex-col gap-2 sm:flex-row">
        <Input
          name="name"
          placeholder="Key name, e.g. Production"
          maxLength={60}
          aria-label="Key name"
        />
        <Button type="submit" disabled={pending} className="shrink-0">
          <KeyRound className="size-4" />
          {pending ? 'Creating…' : 'Create key'}
        </Button>
      </form>
      <FieldError>{state.error}</FieldError>

      {state.created && (
        <Alert
          tone="success"
          title={`Key "${state.created.name}" created. Copy it now: it is shown only once.`}
        >
          <div className="mt-2 flex items-center gap-2">
            <code className="block flex-1 overflow-x-auto rounded-md border border-fd-border bg-fd-background px-3 py-2 font-mono text-xs text-fd-foreground">
              {state.created.key}
            </code>
            <CopyButton text={state.created.key} />
          </div>
          <pre className="mt-3 overflow-x-auto rounded-md bg-fd-background p-3 text-xs text-fd-foreground">
            {`curl -H "Authorization: Bearer ${state.created.key}" \\\n  ${apiUrl}/v1/json/8.8.8.8`}
          </pre>
        </Alert>
      )}

      {keys.length === 0 ? (
        <p className="text-sm text-fd-muted-foreground">No keys yet. Create one to get started.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-fd-muted-foreground">
              <tr className="border-b border-fd-border">
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 pr-4 font-medium">Key</th>
                <th className="py-2 pr-4 font-medium">Created</th>
                <th className="py-2 pr-4 font-medium">Last used</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id} className="border-b border-fd-border/60 last:border-0">
                  <td className="py-3 pr-4 font-medium">{key.name}</td>
                  <td className="py-3 pr-4 font-mono text-xs">{key.prefix}…</td>
                  <td className="py-3 pr-4 text-fd-muted-foreground">
                    {formatDate(key.createdAt)}
                  </td>
                  <td className="py-3 pr-4 text-fd-muted-foreground">
                    {formatDate(key.lastUsedAt)}
                  </td>
                  <td className="py-3 text-right">
                    <form
                      action={revokeKeyAction}
                      onSubmit={(event) => {
                        if (!window.confirm(`Revoke "${key.name}"? Requests using it will fail.`)) {
                          event.preventDefault();
                        }
                      }}
                    >
                      <input type="hidden" name="keyId" value={key.id} />
                      <Button type="submit" variant="danger" className="px-3 py-1.5 text-xs">
                        Revoke
                      </Button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-fd-muted-foreground">
            Revoked keys stop working within a minute.
          </p>
        </div>
      )}
    </div>
  );
}
