import fs from 'fs/promises'
import path from 'path'

// Runs fn over items with at most `limit` in flight; results keep input order.
// The cap matters: macOS allows only 256 open files per process by default.
export async function mapLimit (items, fn, limit = 32) {
  const results = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

// Queues file writes so the caller can keep working while they land. At most
// `limit` are in flight; write() waits for a free slot, and flush() waits for
// the rest and throws the first failure.
export function createWriter (limit = 32) {
  const inflight = new Set()
  const madeDirs = new Set()
  const latest = new Map() // file → its most recent queued write
  let failure = null

  async function write (file, data) {
    while (inflight.size >= limit) await Promise.race(inflight)
    // Writes to one path land in the order queued, so the last one wins.
    const previous = latest.get(file)
    const p = (async () => {
      await previous
      const dir = path.dirname(file)
      if (!madeDirs.has(dir)) {
        await fs.mkdir(dir, { recursive: true })
        madeDirs.add(dir)
      }
      await fs.writeFile(file, data)
    })()
      .catch((err) => {
        failure ??= err
      })
      .finally(() => inflight.delete(p))
    latest.set(file, p)
    inflight.add(p)
  }

  async function flush () {
    await Promise.all(inflight)
    if (failure) throw failure
  }

  return { write, flush }
}
