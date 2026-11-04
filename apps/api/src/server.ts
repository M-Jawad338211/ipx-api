import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { preloadTimezones } from './enrich/timezone.ts';

const config = loadConfig();
const app = await buildApp({ config });
const { store } = app;

await store.refresh();
if (!store.ready) {
  app.log.error(
    { dataDir: config.dataDir },
    'No IP database could be loaded: lookups answer 503 until data/ is populated (run pnpm update-db)',
  );
}
if (config.tzPreload) {
  const started = Date.now();
  preloadTimezones();
  app.log.info({ ms: Date.now() - started }, 'timezone polygons preloaded');
}
store.startAutoRefresh(config.refreshSeconds);
await app.services.connect();
app.services.startBackgroundJobs();

await app.listen({ host: config.host, port: config.port });

let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'shutting down');
    store.stopAutoRefresh();
    app.close().then(
      () => process.exit(0),
      (error: unknown) => {
        app.log.error({ err: error }, 'error during shutdown');
        process.exit(1);
      },
    );
  });
}
