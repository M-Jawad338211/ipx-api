import type { Metadata } from 'next';
import { ProsePage } from '@/components/prose-page';

export const metadata: Metadata = { title: 'Credits' };

const SOURCES = [
  {
    name: 'DB-IP',
    url: 'https://db-ip.com',
    what: 'IP to city geolocation (City Lite database)',
    license: 'Creative Commons Attribution 4.0 (CC BY 4.0)',
  },
  {
    name: 'IPinfo',
    url: 'https://ipinfo.io',
    what: 'IP to country and ASN (IPinfo Lite database)',
    license: 'Creative Commons Attribution-ShareAlike 4.0 (CC BY-SA 4.0)',
  },
  {
    name: 'The Tor Project',
    url: 'https://check.torproject.org/exit-addresses',
    what: 'Tor exit node list',
    license: 'Published by the Tor Project',
  },
  {
    name: 'mledoze/countries',
    url: 'https://github.com/mledoze/countries',
    what: 'Country facts: flags, calling codes, currencies, languages',
    license: 'Open Database License (ODbL 1.0)',
  },
  {
    name: 'IANA tz database',
    url: 'https://www.iana.org/time-zones',
    what: 'Time zones per country',
    license: 'Public domain',
  },
  {
    name: 'timezone-boundary-builder / geo-tz',
    url: 'https://github.com/evansiroky/timezone-boundary-builder',
    what: 'Time zone boundaries for coordinates',
    license: 'ODbL 1.0 (data), MIT (geo-tz)',
  },
  {
    name: 'Cloud provider IP ranges',
    url: 'https://ip-ranges.amazonaws.com/ip-ranges.json',
    what: 'Published ranges of AWS, Google, Google Cloud, Microsoft Azure, Cloudflare and DigitalOcean',
    license: 'Published by each provider',
  },
];

export default function CreditsPage() {
  return (
    <ProsePage title="Credits">
      <p>This service is built on open data. Thank you to everyone who publishes it.</p>
      <ul>
        {SOURCES.map((s) => (
          <li key={s.name}>
            <a href={s.url}>{s.name}</a>: {s.what}. License: {s.license}.
          </li>
        ))}
      </ul>
      <p>
        IP address data powered by <a href="https://ipinfo.io">IPinfo</a>. IP geolocation by{' '}
        <a href="https://db-ip.com">DB-IP</a>.
      </p>
    </ProsePage>
  );
}
