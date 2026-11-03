// Minimal typings for the parts of autocannon's programmatic API used by bench.ts.
declare module 'autocannon' {
  export interface Request {
    method?: string;
    path?: string;
    setupRequest?: (request: Request) => Request;
  }
  export interface Options {
    url: string;
    connections?: number;
    duration?: number;
    pipelining?: number;
    requests?: Request[];
  }
  export interface Histogram {
    average: number;
    p50: number;
    p90: number;
    p99: number;
    max: number;
  }
  export interface Result {
    requests: Histogram & { total: number };
    latency: Histogram;
    errors: number;
    timeouts: number;
    non2xx: number;
  }
  function autocannon(options: Options): Promise<Result>;
  export default autocannon;
}
