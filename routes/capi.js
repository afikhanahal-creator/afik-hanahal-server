import { Router }     from 'express'
import { createHash } from 'crypto'

const router = Router()

const CAPI_TOKEN = process.env.META_CAPI_TOKEN
const PIXEL_ID   = process.env.META_PIXEL_ID

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
    const resp = await fetch(
      `https://graph.facebook.com/v25.0/${PIXEL_ID}/events?access_token=${CAPI_TOKEN}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ data }),
      }
    )
    const result = await resp.json()
    console.log('[CAPI] Response:', JSON.stringify(result))
    return res.status(resp.ok ? 200 : 400).json(result)
  } catch (err) {
    console.error('[CAPI] Fetch error:', err)
    return res.status(500).json({ error: err.message })
  }
})

export default router
