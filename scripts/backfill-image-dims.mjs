#!/usr/bin/env node
/**
 * backfill-image-dims.mjs
 *
 * For every message with `imageUrl` but missing `imageWidth`/`imageHeight`/`imageBlurHash`:
 *   1. Probe the remote image for its natural dimensions.
 *   2. Download + resize to 32 px wide thumbnail with `sharp`.
 *   3. Encode a BlurHash from the thumbnail pixels.
 *   4. Update the Firestore document.
 *
 * Requirements:
 *   pnpm add -D sharp            (native image processing)
 *   blurhash is already a production dependency
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/backfill-image-dims.mjs
 *
 * Dry-run (prints changes, does not write):
 *   DRY_RUN=1 GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/backfill-image-dims.mjs
 */

import { readFileSync } from 'fs'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const SA = process.env.GOOGLE_APPLICATION_CREDENTIALS
if (!SA) { console.error('Set GOOGLE_APPLICATION_CREDENTIALS'); process.exit(1) }

const DRY_RUN = process.env.DRY_RUN === '1'

const serviceAccount = JSON.parse(readFileSync(SA, 'utf8'))
initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id })
const db = getFirestore()

// Lazy-load sharp and blurhash (devDependency and prod dep respectively)
async function loadDeps() {
  const [sharpMod, { encode }] = await Promise.all([
    import('sharp'),
    import('blurhash'),
  ])
  return { sharp: sharpMod.default, encode }
}

async function fetchImageBuffer(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
  const arrayBuf = await res.arrayBuffer()
  return Buffer.from(arrayBuf)
}

async function backfill() {
  console.log(`Starting image-dims backfill${DRY_RUN ? ' [DRY RUN]' : ''}…`)

  const { sharp, encode } = await loadDeps()

  const snap = await db.collection('messages').where('imageUrl', '!=', null).get()
  console.log(`Found ${snap.size} messages with imageUrl`)

  let skipped = 0, updated = 0, failed = 0

  for (const doc of snap.docs) {
    const data = doc.data()
    const hasW = typeof data.imageWidth === 'number'
    const hasH = typeof data.imageHeight === 'number'
    const hasHash = typeof data.imageBlurHash === 'string' && data.imageBlurHash.length > 0

    if (hasW && hasH && hasHash) { skipped++; continue }

    const url = data.imageUrl
    if (!url) { skipped++; continue }

    process.stdout.write(`[${doc.id}] `)

    try {
      const buf = await fetchImageBuffer(url)

      // Get natural dimensions from the full buffer
      const meta = await sharp(buf).metadata()
      const width = meta.width
      const height = meta.height
      if (!width || !height) throw new Error('No dimensions from sharp')

      // Resize to 32 px wide (proportional) for BlurHash encoding
      const thumbW = 32
      const thumbH = Math.max(1, Math.round((height / width) * thumbW))
      const { data: raw } = await sharp(buf)
        .resize(thumbW, thumbH)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })

      const blurHash = encode(new Uint8ClampedArray(raw), thumbW, thumbH, 4, 3)

      const update = {}
      if (!hasW || !hasH) { update.imageWidth = width; update.imageHeight = height }
      if (!hasHash) update.imageBlurHash = blurHash

      console.log(`ok ${width}×${height}  hash=${blurHash.slice(0, 12)}…`)

      if (!DRY_RUN) await doc.ref.update(update)
      updated++
    } catch (err) {
      console.error(`FAILED — ${err.message || err}`)
      failed++
    }
  }

  console.log(`\nDone. updated=${updated}  skipped=${skipped}  failed=${failed}`)
  if (DRY_RUN) console.log('(dry run — no writes)')
}

backfill().catch(err => { console.error('Backfill aborted:', err); process.exit(1) })
