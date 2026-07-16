export function chunkValues<T>(values: T[], size: number): T[][] {
  const safeSize = Math.max(1, Math.floor(size))
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += safeSize) {
    chunks.push(values.slice(index, index + safeSize))
  }
  return chunks
}

/** Runs bounded parallel work while preserving result order. */
export async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length)
  const workerCount = Math.min(values.length, Math.max(1, Math.floor(concurrency)))
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(values[index], index)
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}
