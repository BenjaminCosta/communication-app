import assert from "node:assert/strict"
import test from "node:test"
import { chunkValues, mapWithConcurrency } from "../functions/src/shared/batches"

test("chunks multicast targets without exceeding the requested size", () => {
  const chunks = chunkValues(Array.from({ length: 1201 }, (_, index) => index), 500)
  assert.deepEqual(chunks.map((chunk) => chunk.length), [500, 500, 201])
  assert.deepEqual(chunks.flat(), Array.from({ length: 1201 }, (_, index) => index))
})
test("uses a safe minimum chunk size", () => {
  assert.deepEqual(chunkValues([1, 2, 3], 0), [[1], [2], [3]])
})

test("maps in bounded batches and preserves result order", async () => {
  let active = 0
  let maxActive = 0
  const values = Array.from({ length: 11 }, (_, index) => index)
  const results = await mapWithConcurrency(values, 3, async (value) => {
    active += 1
    maxActive = Math.max(maxActive, active)
    await new Promise((resolve) => setTimeout(resolve, value % 2 === 0 ? 2 : 1))
    active -= 1
    return value * 2
  })

  assert.equal(maxActive <= 3, true)
  assert.deepEqual(results, values.map((value) => value * 2))
})
