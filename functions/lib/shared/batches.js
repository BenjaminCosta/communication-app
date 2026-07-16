"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.chunkValues = chunkValues;
exports.mapWithConcurrency = mapWithConcurrency;
function chunkValues(values, size) {
    const safeSize = Math.max(1, Math.floor(size));
    const chunks = [];
    for (let index = 0; index < values.length; index += safeSize) {
        chunks.push(values.slice(index, index + safeSize));
    }
    return chunks;
}
/** Runs bounded parallel work while preserving result order. */
async function mapWithConcurrency(values, concurrency, mapper) {
    const results = new Array(values.length);
    const workerCount = Math.min(values.length, Math.max(1, Math.floor(concurrency)));
    let nextIndex = 0;
    async function worker() {
        while (nextIndex < values.length) {
            const index = nextIndex;
            nextIndex += 1;
            results[index] = await mapper(values[index], index);
        }
    }
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
}
//# sourceMappingURL=batches.js.map