import { loader } from 'fumadocs-core/source';
import { defineDocs } from 'fumadocs-mdx/macro';
import { openapi } from './openapi.ts';

// Guides live in the repository's docs/ folder; the API reference comes from openapi.json.
const docs = defineDocs({
  dir: '../../docs',
});

export const source = loader(
  {
    docs: docs.toFumadocsSource(),
    openapi: await openapi.staticSource({ baseDir: 'reference' }),
  },
  {
    baseUrl: '/docs',
    plugins: [openapi.loaderPlugin()],
  },
);
