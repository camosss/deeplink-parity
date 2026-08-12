/**
 * Run tasks with a bounded number in flight.
 *
 * Some apps declare a domain per country, and firing every request at once looks
 * like an attack from the receiving end — it also causes the timeouts it then
 * reports as findings. Results keep input order.
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0

  const worker = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await task(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/** Concurrent requests per run. Low enough to stay polite on a shared host. */
export const FETCH_CONCURRENCY = 6
