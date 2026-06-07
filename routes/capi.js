import { Router }     from 'express'
import { createHash } from 'crypto'

const router = Router()

// Two Meta pixels/datasets — every event is forwarded to BOTH so each stays active:
//  1. הפיקסל של אפיק הנחל  (1311196023271539) — new dataset + its CAPI token
//  2. legacy pixel        (1341264237748951) — kept active alongside the new one
// Env vars override the PRIMARY (new) target's pixel/token.
const CAPI_TARGETS = [
  {
    pixel: process.env.META_PIXEL_ID   || '1311196023271539',
    token: process.env.META_CAPI_TOKEN ||
      'EAAVd8MwSYuYBRuAUTYO2q8klvHkWZCnKCDiDUCbHFrys8UTqhUq8k1LQvaSJL8SSYhnAqoPFaPDe3T5o3lNFSzwyRsOnnSBVwGlxgdKD17hVa4LZBOWWB6MgtsMR7mKBfDH7SH3SrFUWRaNbm4qL0kW6GoyamFpLIWaxmudaNgvw5OHZAVFOXLCmzzprQZDZD',
  },
  {
    pixel: '1341264237748951',
    token: process.env.META_CAPI_TOKEN_LEGACY ||
      'EAAOBFZAXNIScBRSg6zKgQmxOqYMWUNSu1YmLZC6hcd44hbs0FpZCr3qKlbHtx7UJEbCPXDhWBZCOLq9xITdQXJwGiBz2gnzZC4iA0F6uGHFLIPWUTo2iHLK11xSHBPsZCHuf3UpzcQfXrmjlo3JZBtkmcfGDKetE2J4CECQelzw3WJCTOUjZBhOgFSXlzPWEqAZDZD',
  },
]

const sha256 = v =>
  v ? createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex') : undefined

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '')
  if (!digits) return null
  if (digits.startsWith('972')) return digits
  if (digits.startsWith('0'))   return '972' + digits.slice(1)
  return digits
}

// Handle CORS preflight here (in case request comes from a different origin path)
router.options('/', (req, res) => res.status(200).end())

router.post('/', async (req, res) => {
  const { events = [] } = req.body || {}
  if (!events.length) return res.status(400).json({ error: 'No events provided' })

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  const ua = req.headers['user-agent'] || ''

  const data = events.map(ev => {
    const user_data = {
      client_ip_address: ip || undefined,
      client_user_agent: ua || undefined,
    }
    if (ev.email) user_data.em = [sha256(ev.email)]
    if (ev.phone) {
      const ph = normalizePhone(ev.phone)
      if (ph) user_data.ph = [sha256(ph)]
    }
    if (ev.name) {
      const parts = String(ev.name).trim().split(/\s+/)
      user_data.fn = [sha256(parts[0])]
      if (parts.length > 1) user_data.ln = [sha256(parts.slice(1).join(' '))]
    }
    if (ev.fbp) user_data.fbp = ev.fbp
    if (ev.fbc) user_data.fbc = ev.fbc

    const entry = {
      event_name:       ev.event_name,
      event_time:       Math.floor(Date.now() / 1000),
      event_source_url: ev.url || 'https://afikhanahal.co.il/',
      action_source:    'website',
      user_data,
    }
    if (ev.event_id) entry.event_id = ev.event_id
    if (ev.custom_data && Object.keys(ev.custom_data).length) {
      entry.custom_data = ev.custom_data
    }
    return entry
  })

  try {
    const results = await Promise.all(CAPI_TARGETS.map(async t => {
      const resp = await fetch(
        `https://graph.facebook.com/v25.0/${t.pixel}/events?access_token=${t.token}`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ data }),
        }
      )
      const body = await resp.json().catch(() => ({}))
      console.log(`[CAPI] ${t.pixel} →`, JSON.stringify(body))
      return { pixel: t.pixel, ok: resp.ok, body }
    }))
    const ok = results.some(r => r.ok)
    return res.status(ok ? 200 : 400).json({ results })
  } catch (err) {
    console.error('[CAPI] Fetch error:', err)
    return res.status(500).json({ error: err.message })
  }
})

export default router
