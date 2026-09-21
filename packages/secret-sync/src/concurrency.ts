import { SecretSyncError } from './errors';

export const SHARED_DEFAULT_CONCURRENCY = 4;
export const SHARED_MAX_CONCURRENCY = 8;

export function validateConcurrency(value: number | undefined, fallback: number): number {
  const candidate = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(candidate) || candidate < 1 || candidate > SHARED_MAX_CONCURRENCY) {
    throw new SecretSyncError('validation', `Concurrency must be an integer between 1 and ${SHARED_MAX_CONCURRENCY}.`);
  }
  return candidate;
}

export async function mapWithConcurrency<T, R>(
  items: ReadonlyArray<T>,
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const limit = validateConcurrency(concurrency, SHARED_DEFAULT_CONCURRENCY);
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers: Promise<void>[] = [];
  const count = Math.min(limit, items.length);
  for (let w = 0; w < count; w += 1) {
    workers.push(
      (async () => {
        for (;;) {
          const current = next;
          next += 1;
          if (current >= items.length) {
            return;
          }
          const item = items[current] as T;
          results[current] = await fn(item, current);
        }
      })(),
    );
  }
  await Promise.all(workers);
  return results;
}
