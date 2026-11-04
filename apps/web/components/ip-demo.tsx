'use client';

import { Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button, Input } from './ui';

type State =
  | { status: 'loading' }
  | { status: 'done'; body: unknown; ms: number }
  | { status: 'error'; message: string };

/** Live lookup against the public API: the visitor's own IP first, then anything they type. */
export function IpDemo({ apiUrl }: { apiUrl: string }) {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<State>({ status: 'loading' });

  const run = useCallback(
    async (ip: string) => {
      setState({ status: 'loading' });
      const started = performance.now();
      try {
        const res = await fetch(`${apiUrl}/v1/json${ip ? `/${encodeURIComponent(ip)}` : ''}`);
        const body: unknown = await res.json();
        setState({ status: 'done', body, ms: Math.round(performance.now() - started) });
      } catch {
        setState({ status: 'error', message: `Could not reach the API at ${apiUrl}.` });
      }
    },
    [apiUrl],
  );

  useEffect(() => {
    void run('');
  }, [run]);

  return (
    <div className="overflow-hidden rounded-xl border border-fd-border bg-fd-card shadow-sm">
      <form
        className="flex gap-2 border-b border-fd-border p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void run(query.trim());
        }}
      >
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Your IP, or try 8.8.8.8 or 2a02:2028::1"
          aria-label="IP address"
          className="font-mono"
        />
        <Button type="submit" className="shrink-0">
          <Search className="size-4" />
          Look up
        </Button>
      </form>
      <div className="flex items-center justify-between px-4 pt-3 font-mono text-xs text-fd-muted-foreground">
        <span>GET /v1/json{query.trim() ? `/${query.trim()}` : ''}</span>
        {state.status === 'done' && (
          <span className="flex gap-3">
            <a
              href={`/correct${query.trim() ? `?ip=${encodeURIComponent(query.trim())}` : ''}`}
              className="underline underline-offset-4"
            >
              Location wrong?
            </a>
            {state.ms} ms
          </span>
        )}
      </div>
      <pre className="h-80 overflow-auto px-4 pb-4 pt-2 font-mono text-xs leading-relaxed">
        {state.status === 'loading' && <span className="text-fd-muted-foreground">Loading…</span>}
        {state.status === 'error' && <span className="text-red-500">{state.message}</span>}
        {state.status === 'done' && JSON.stringify(state.body, null, 2)}
      </pre>
    </div>
  );
}
