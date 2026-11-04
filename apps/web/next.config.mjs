import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMDX } from 'fumadocs-mdx/next';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// The monorepo keeps one .env at the repository root.
try {
  process.loadEnvFile(path.join(root, '.env'));
} catch {
  // no .env: rely on the real environment
}

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  transpilePackages: ['@ipx/db', '@ipx/shared'],
  serverExternalPackages: ['ioredis', 'postgres'],
  turbopack: { root },
  // Self-contained server for the Docker image (traces workspace packages from the repo root).
  output: 'standalone',
  outputFileTracingRoot: root,
  poweredByHeader: false,
};

const withMDX = createMDX();

export default withMDX(config);
