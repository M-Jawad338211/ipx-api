import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="font-semibold tracking-tight">
          ipx<span className="text-fd-primary">.</span>
        </span>
      ),
    },
    links: [
      { text: 'Docs', url: '/docs' },
      { text: 'Pricing', url: '/#pricing' },
      { text: 'Dashboard', url: '/dashboard' },
    ],
  };
}
