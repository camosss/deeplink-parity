import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mapLimit } from '../src/fetch/pool.js'

// Found by running against an app that declares a domain per country: firing every
// request at once produced the timeouts it then reported as findings
test('never exceeds the concurrency limit', async () => {
  let inFlight = 0
  let peak = 0

  await mapLimit(Array.from({ length: 50 }, (_, i) => i), 6, async (n) => {
    inFlight++
    peak = Math.max(peak, inFlight)
    await new Promise((r) => setTimeout(r, 1))
    inFlight--
    return n
  })

  assert.ok(peak <= 6, `peaked at ${peak} concurrent tasks`)
  assert.ok(peak > 1, 'expected real concurrency, not serial execution')
})

test('keeps results in input order', async () => {
  const out = await mapLimit([30, 5, 20, 1], 3, async (ms) => {
    await new Promise((r) => setTimeout(r, ms))
    return ms
  })
  assert.deepEqual(out, [30, 5, 20, 1])
})
