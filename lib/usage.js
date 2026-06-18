// ── Supabase Storage usage monitor ────────────────────────────────────────────
// Measures how much of the (free-tier) Storage quota is in use and alerts the
// admin via WhatsApp before the bucket fills up. The free tier is ~1 GB of
// Storage; once it's exceeded uploads start failing, so an early warning lets
// the admin clean up or move media to Cloudinary before anything breaks.
//
// Tunable via env vars:
//   SUPABASE_STORAGE_LIMIT_MB    – quota to measure against (default 1024 = 1GB)
//   USAGE_ALERT_PCT              – alert threshold as a percent (default 80)
//   USAGE_ALERT_COOLDOWN_HOURS   – min hours between repeat alerts (default 24)

import { supabase } from './supabase.js'
import { IMAGE_BUCKET, VIDEO_BUCKET, PDF_BUCKET } from './storage.js'
import { sendAdminWhatsAppText } from './notifications.js'

const STORAGE_LIMIT_MB = Number(process.env.SUPABASE_STORAGE_LIMIT_MB || 1024)
const ALERT_PCT        = Number(process.env.USAGE_ALERT_PCT || 80)
const COOLDOWN_HOURS   = Number(process.env.USAGE_ALERT_COOLDOWN_HOURS || 24)

const BUCKETS = [IMAGE_BUCKET, VIDEO_BUCKET, PDF_BUCKET]
const PAGE = 1000

let _lastAlertAt = 0 // epoch ms of the last alert sent (in-process debounce)

const toMB = bytes => Math.round((bytes / 1048576) * 10) / 10

// Sum the size of every object in a bucket, paginating through the listing.
// Folder placeholders carry no metadata.size, so they're skipped. A missing
// bucket (not yet auto-created) lists as empty rather than erroring out.
async function bucketUsage(bucket) {
  let bytes = 0, objects = 0, offset = 0
  while (true) {
    const { data, error } = await supabase.storage.from(bucket).list('', {
      limit: PAGE,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    })
    if (error) {
      console.warn(`[usage] list ${bucket} failed:`, error.message)
      break
    }
    if (!data?.length) break
    for (const o of data) {
      const size = o?.metadata?.size
      if (typeof size === 'number') { bytes += size; objects++ }
    }
    if (data.length < PAGE) break
    offset += PAGE
  }
  return { bytes, objects }
}

// Returns a snapshot of Storage usage across all media buckets.
export async function getStorageUsage() {
  const buckets = []
  let totalBytes = 0, totalObjects = 0
  for (const b of BUCKETS) {
    const u = await bucketUsage(b)
    buckets.push({ bucket: b, megabytes: toMB(u.bytes), objects: u.objects })
    totalBytes += u.bytes
    totalObjects += u.objects
  }
  const limitBytes = STORAGE_LIMIT_MB * 1048576
  const usedPct = limitBytes ? Math.round((totalBytes / limitBytes) * 1000) / 10 : 0
  return {
    totalMB: toMB(totalBytes),
    totalObjects,
    limitMB: STORAGE_LIMIT_MB,
    usedPct,
    alertPct: ALERT_PCT,
    overThreshold: usedPct >= ALERT_PCT,
    buckets,
  }
}

// Measure usage, log it, and send a one-off WhatsApp alert when over the
// threshold (debounced by COOLDOWN_HOURS so it can't spam). Safe to call on a
// schedule — never throws.
export async function checkUsageAndAlert() {
  if (!supabase) return null
  let usage
  try {
    usage = await getStorageUsage()
  } catch (e) {
    console.warn('[usage] check failed:', e.message)
    return null
  }

  console.log(`[usage] storage ${usage.totalMB}MB / ${usage.limitMB}MB (${usage.usedPct}%) · ${usage.totalObjects} objects`)

  if (usage.overThreshold) {
    const hoursSince = (Date.now() - _lastAlertAt) / 3600000
    if (hoursSince >= COOLDOWN_HOURS) {
      _lastAlertAt = Date.now()
      const lines = [
        '⚠️ *אחסון Supabase מתקרב למגבלה*',
        '',
        `📦 בשימוש: ${usage.totalMB}MB מתוך ${usage.limitMB}MB (${usage.usedPct}%)`,
        `🗂️ ${usage.totalObjects} קבצים`,
        '',
        'מומלץ לפנות מקום (מחיקת נכסים ישנים) או להעביר תמונות ל-Cloudinary כדי להישאר במסלול החינמי.',
      ].join('\n')
      await sendAdminWhatsAppText(lines).catch(() => {})
    } else {
      console.log(`[usage] over threshold but within cooldown (${COOLDOWN_HOURS}h) — no alert`)
    }
  }

  return usage
}
