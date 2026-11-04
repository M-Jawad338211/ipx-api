import { source } from '@/lib/source';
import { publicApiUrl } from '@/server/env';

export const revalidate = false;

/** llms.txt index of the documentation (https://llmstxt.org). */
export function GET(): Response {
  const pages = source
    .getPages()
    .map((page) => {
      const description = page.data.description ? `: ${page.data.description}` : '';
      return `- [${page.data.title}](${page.url})${description}`;
    })
    .join('\n');
  const body = [
    '# ipx IP Lookup API',
    '',
    '> Geolocation, network, time zone, locale and security data for any IPv4 or IPv6 address, as JSON. Anonymous use is limited per IP; API keys raise the limits.',
    '',
    '## Docs',
    '',
    pages,
    '',
    '## API',
    '',
    `- [OpenAPI 3.1 document](${publicApiUrl}/openapi.json): machine-readable description of every endpoint`,
    '',
  ].join('\n');
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
