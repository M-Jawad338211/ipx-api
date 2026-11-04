'use client';

import Script from 'next/script';
import { useActionState, useEffect, useState } from 'react';
import { submitCorrectionAction, type CorrectionFormState } from '@/server/actions';
import { Alert, Button, Input, Label } from './ui';

interface CurrentLocation {
  ip: string;
  country_code: string | null;
  region: string | null;
  city: string | null;
}

const SELECT_CLASS =
  'w-full rounded-lg border border-fd-border bg-fd-background px-3 py-2 text-sm outline-none focus:border-fd-primary focus:ring-2 focus:ring-fd-primary/20';

export function CorrectionForm(props: {
  apiUrl: string;
  initialIp: string | null;
  countries: [code: string, name: string][];
  turnstileSiteKey: string | null;
}) {
  const [state, action, pending] = useActionState<CorrectionFormState, FormData>(
    submitCorrectionAction,
    {},
  );
  const [ip, setIp] = useState(props.initialIp ?? '');
  const [current, setCurrent] = useState<CurrentLocation | null>(null);
  const [country, setCountry] = useState('');

  // Prefill with the visitor's IP (or the one in the URL) and show what we currently answer.
  useEffect(() => {
    const target = props.initialIp ? `/${encodeURIComponent(props.initialIp)}` : '';
    fetch(
      `${props.apiUrl}/v1/json${target}?fields=ip,location.country_code,location.region,location.city`,
    )
      .then((res) => res.json())
      .then((body: { success?: boolean; ip?: string; location?: Omit<CurrentLocation, 'ip'> }) => {
        if (!body.success || !body.ip || !body.location) return;
        setIp((value) => value || body.ip!);
        setCurrent({ ip: body.ip, ...body.location });
        setCountry((value) => value || body.location!.country_code || '');
      })
      .catch(() => {});
  }, [props.apiUrl, props.initialIp]);

  if (state.done) {
    return (
      <Alert tone="success" title="Thanks! Your report was received.">
        We review reports by hand. Once accepted, the corrected location is used for this address
        within a few minutes.
      </Alert>
    );
  }

  const describe = (c: CurrentLocation) =>
    [c.city, c.region, c.country_code].filter(Boolean).join(', ') || 'no location';

  return (
    <form action={action} className="space-y-4">
      {props.turnstileSiteKey && (
        <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
      )}
      {state.error && <Alert tone="error" title={state.error} />}
      <div>
        <Label htmlFor="ip">IP address</Label>
        <Input
          id="ip"
          name="ip"
          value={ip}
          onChange={(e) => setIp(e.target.value)}
          required
          className="font-mono"
        />
        {current && current.ip === ip.trim() && (
          <p className="mt-1.5 text-xs text-fd-muted-foreground">
            We currently say: {describe(current)}
          </p>
        )}
      </div>
      <div>
        <Label htmlFor="country">Correct country</Label>
        <select
          id="country"
          name="country"
          required
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">Choose a country</option>
          {props.countries.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="region">Region / state</Label>
          <Input id="region" name="region" maxLength={100} />
        </div>
        <div>
          <Label htmlFor="city">City</Label>
          <Input id="city" name="city" maxLength={100} />
        </div>
      </div>
      <div>
        <Label htmlFor="email">Email (optional, if we may ask you about it)</Label>
        <Input id="email" name="email" type="email" maxLength={254} />
      </div>
      <div>
        <Label htmlFor="note">Note (optional)</Label>
        <textarea
          id="note"
          name="note"
          maxLength={1000}
          rows={3}
          className={SELECT_CLASS}
          placeholder="For example: this is a fixed office line of ISP X in Lahore."
        />
      </div>
      {props.turnstileSiteKey && (
        <div className="cf-turnstile" data-sitekey={props.turnstileSiteKey} />
      )}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Sending…' : 'Send correction'}
      </Button>
    </form>
  );
}
