/**
 * Minimal Prometheus metrics (text exposition format 0.0.4), no client library needed.
 * Request metrics are recorded in an onResponse hook; data gauges are read at scrape time.
 */

const DURATION_BUCKETS = [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5];

type Labels = Record<string, string>;

function labelText(labels: Labels): string {
  const parts = Object.entries(labels).map(
    ([k, v]) => `${k}="${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`,
  );
  return parts.length ? `{${parts.join(',')}}` : '';
}

class Counter {
  readonly #values = new Map<string, { labels: Labels; value: number }>();
  readonly name: string;
  readonly help: string;
  constructor(name: string, help: string) {
    this.name = name;
    this.help = help;
  }
  inc(labels: Labels = {}, by = 1): void {
    const key = labelText(labels);
    const entry = this.#values.get(key);
    if (entry) entry.value += by;
    else this.#values.set(key, { labels, value: by });
  }
  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const { labels, value } of this.#values.values()) {
      lines.push(`${this.name}${labelText(labels)} ${value}`);
    }
    return lines.join('\n');
  }
}

class Histogram {
  readonly #series = new Map<
    string,
    { labels: Labels; counts: number[]; sum: number; count: number }
  >();
  readonly name: string;
  readonly help: string;
  constructor(name: string, help: string) {
    this.name = name;
    this.help = help;
  }
  observe(labels: Labels, seconds: number): void {
    const key = labelText(labels);
    let series = this.#series.get(key);
    if (!series) {
      series = { labels, counts: DURATION_BUCKETS.map(() => 0), sum: 0, count: 0 };
      this.#series.set(key, series);
    }
    for (let i = 0; i < DURATION_BUCKETS.length; i++) {
      if (seconds <= DURATION_BUCKETS[i]!) series.counts[i]!++;
    }
    series.sum += seconds;
    series.count++;
  }
  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const { labels, counts, sum, count } of this.#series.values()) {
      DURATION_BUCKETS.forEach((le, i) => {
        lines.push(`${this.name}_bucket${labelText({ ...labels, le: String(le) })} ${counts[i]}`);
      });
      lines.push(`${this.name}_bucket${labelText({ ...labels, le: '+Inf' })} ${count}`);
      lines.push(`${this.name}_sum${labelText(labels)} ${sum}`);
      lines.push(`${this.name}_count${labelText(labels)} ${count}`);
    }
    return lines.join('\n');
  }
}

export interface Gauge {
  name: string;
  help: string;
  values: () => { labels?: Labels; value: number | null }[];
}

export class Metrics {
  readonly requests = new Counter('ipx_http_requests_total', 'HTTP requests by route and status.');
  readonly duration = new Histogram(
    'ipx_http_request_duration_seconds',
    'HTTP request duration by route.',
  );
  readonly rateLimited = new Counter(
    'ipx_rate_limited_total',
    'Requests refused with 429, by caller kind (anonymous or key).',
  );
  readonly usageFlushed = new Counter(
    'ipx_usage_flushed_total',
    'Keyed lookups written from Redis to Postgres.',
  );
  readonly #gauges: Gauge[] = [];

  addGauge(gauge: Gauge): void {
    this.#gauges.push(gauge);
  }

  render(): string {
    const blocks = [this.requests.render(), this.duration.render(), this.rateLimited.render()];
    blocks.push(this.usageFlushed.render());
    for (const gauge of this.#gauges) {
      const lines = [`# HELP ${gauge.name} ${gauge.help}`, `# TYPE ${gauge.name} gauge`];
      for (const { labels, value } of gauge.values()) {
        if (value !== null && Number.isFinite(value)) {
          lines.push(`${gauge.name}${labelText(labels ?? {})} ${value}`);
        }
      }
      blocks.push(lines.join('\n'));
    }
    return `${blocks.join('\n')}\n`;
  }
}
