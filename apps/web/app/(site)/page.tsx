import { ANONYMOUS_LIMITS, PLANS } from '@ipx/db';
import { Clock, Globe2, Languages, Network, ShieldCheck } from 'lucide-react';
import { IpDemo } from '@/components/ip-demo';
import { Card, LinkButton } from '@/components/ui';
import { publicApiUrl } from '@/server/env';

const FEATURES = [
  {
    icon: Globe2,
    title: 'Location',
    text: 'Continent, country, region, city and coordinates, with names in 10 languages.',
  },
  { icon: Network, title: 'Network', text: 'ASN, operator name and domain for every address.' },
  {
    icon: Clock,
    title: 'Time zone',
    text: 'IANA zone, current UTC offset, DST flag and local time, computed per request.',
  },
  {
    icon: Languages,
    title: 'Locale',
    text: 'Flag, calling code, currency and languages of the country.',
  },
  {
    icon: ShieldCheck,
    title: 'Security',
    text: 'Tor exit nodes and cloud or hosting ranges (AWS, Google, Azure, Cloudflare, DigitalOcean).',
  },
];

function price(cents: number | null): string {
  if (cents === 0) return '$0';
  if (cents === null) return 'Contact us';
  return `$${(cents / 100).toLocaleString('en-US')} / month`;
}

export default function HomePage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-6">
      <section className="grid items-center gap-10 py-16 lg:grid-cols-2 lg:py-24">
        <div>
          <p className="mb-3 text-sm font-medium text-fd-primary">
            IPv4 and IPv6 · JSON · no key needed
          </p>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Know where every request comes from.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-fd-muted-foreground">
            One HTTP call returns location, network, time zone, locale and security signals for any
            IP address. Answers come from in-memory databases in about a millisecond.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <LinkButton href="/signup">Get a free API key</LinkButton>
            <LinkButton href="/docs" variant="secondary">
              Read the docs
            </LinkButton>
          </div>
          <pre className="mt-8 overflow-x-auto rounded-lg border border-fd-border bg-fd-card px-4 py-3 font-mono text-sm">
            curl {publicApiUrl}/v1/json/8.8.8.8
          </pre>
        </div>
        <IpDemo apiUrl={publicApiUrl} />
      </section>

      <section className="py-12">
        <h2 className="text-2xl font-semibold tracking-tight">What you get for each address</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <Card key={title} className="p-5">
              <Icon className="size-5 text-fd-primary" />
              <h3 className="mt-3 font-medium">{title}</h3>
              <p className="mt-1 text-sm text-fd-muted-foreground">{text}</p>
            </Card>
          ))}
        </div>
      </section>

      <section id="pricing" className="scroll-mt-20 py-12">
        <h2 className="text-2xl font-semibold tracking-tight">Plans</h2>
        <p className="mt-2 text-fd-muted-foreground">
          Without a key: {ANONYMOUS_LIMITS.perMinute} requests per minute and{' '}
          {ANONYMOUS_LIMITS.perDay.toLocaleString('en-US')} per day per IP. With a key, no
          per-minute limit and a monthly quota shared by all your keys.
        </p>
        <div className="mt-6 grid max-w-3xl gap-4 sm:grid-cols-2">
          {PLANS.map((plan) => (
            <Card key={plan.id} className="flex flex-col">
              <h3 className="font-medium">{plan.name}</h3>
              <p className="mt-2 text-2xl font-semibold">{price(plan.priceCents)}</p>
              <p className="mt-1 text-sm text-fd-muted-foreground">
                {plan.monthlyQuota.toLocaleString('en-US')} lookups per month
              </p>
              <ul className="mt-4 flex-1 space-y-1 text-sm text-fd-muted-foreground">
                <li>All response fields</li>
                <li>HTTPS, CORS, JSONP</li>
                <li>Batch lookups (100 per request)</li>
              </ul>
              <LinkButton
                href="/signup"
                variant={plan.id === 'free' ? 'primary' : 'secondary'}
                className="mt-6"
              >
                {plan.id === 'free' ? 'Start free' : 'Get started'}
              </LinkButton>
            </Card>
          ))}
        </div>
      </section>
    </main>
  );
}
