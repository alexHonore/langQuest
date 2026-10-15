import type { NextConfig } from 'next';

/**
 * LangQuest Studio (private administrator CMS).
 *
 * - Workspace packages are TypeScript source (no build step) → `transpilePackages`.
 * - Every screen is authenticated and dynamic, so Cache Components stay off: nothing here
 *   benefits from a static shell and the role gate must run on every request.
 * - `@langquest/ui` root re-exports React Native renderers; the admin only imports the
 *   string art renderers through the `@art/*` tsconfig path (see tsconfig.json).
 */
const nextConfig: NextConfig = {
  transpilePackages: [
    '@langquest/contracts',
    '@langquest/ui',
    '@langquest/locales',
    '@langquest/curriculum',
    '@langquest/media',
    '@langquest/db',
    '@langquest/ai',
  ],
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
