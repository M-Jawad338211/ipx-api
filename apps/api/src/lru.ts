/** Minimal LRU cache on top of Map's insertion order. */
export class Lru<K, V> {
  readonly #max: number;
  readonly #map = new Map<K, V>();

  constructor(max: number) {
    this.#max = max;
  }

  get(key: K): V | undefined {
    const value = this.#map.get(key);
    if (value !== undefined) {
      this.#map.delete(key);
      this.#map.set(key, value);
    }
    return value;
  }

  has(key: K): boolean {
    return this.#map.has(key);
  }

  set(key: K, value: V): void {
    if (this.#map.has(key)) this.#map.delete(key);
    else if (this.#map.size >= this.#max) {
      const oldest = this.#map.keys().next();
      if (!oldest.done) this.#map.delete(oldest.value);
    }
    this.#map.set(key, value);
  }

  get size(): number {
    return this.#map.size;
  }

  clear(): void {
    this.#map.clear();
  }
}
