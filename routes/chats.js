import { Router } from 'express'
import { supabase }      from '../lib/supabase.js'
import { toIntlPhone, saveChatMessage } from '../lib/chats.js'

const router = Router()

const GREEN_INSTANCE = process.env.WA_GREENAPI_INSTANCE
const GREEN_TOKEN    = process.env.WA_GREENAPI_TOKEN
// Derive regional URL from instance ID (e.g. 7107558519 → https://7107.api.greenapi.com)
const GREEN_BASE_URL = (process.env.WA_GREENAPI_URL || (() => {
  const region = String(GREEN_INSTANCE || '').slice(0, 4)
  return region ? `https://${region}.api.greenapi.com` : 'https://api.green-api.com'
})()).replace(/\/$/, '')

function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim()
  if (token !== process.env.ADMIN_TOKEN) return res.status(401).json({ error: 'Unauthorized' })
  next()
}

// GET /api/chats/status — Green API instance connection state
router.get('/status', requireAdmin, async (req, res) => {
  if (!GREEN_INSTANCE || !GREEN_TOKEN) {
    return res.json({ state: 'notConfigured' })
  }
  try {
    const url = `${GREEN_BASE_URL}/waInstance${GREEN_INSTANCE}/getStateInstance/${GREEN_TOKEN}`
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!resp.ok) return res.json({ state: 'error', httpStatus: resp.status })
    const data = await resp.json()
    return res.json({ state: data.stateInstance || 'unknown' })
  } catch (e) {
    console.warn('[chats/status]', e.message)
    return res.json({ state: 'error', error: e.message })
  }
})

// GET /api/chats/conversations — all unique chat participants sorted by last message
router.get('/conversations', requireAdmin, async (req, res) => {
  try {
    if (!supabase) return res.json([])
    const { data, error } = await supabase
      .from('chats')
      .select('phone, direction, message, created_at')
      .order('created_at', { ascending: false })
      .limit(1000)
    if (error) throw error

    // Collapse to one row per phone (first row = most recent)
    const map = new Map()
    for (const row of (data || [])) {
      if (!map.has(row.phone)) {
        map.set(row.phone, {
          phone:         row.phone,
          lastMessage:   row.message,
          lastDirection: row.direction,
          lastAt:        row.created_at,
        })
      }
    }
    return res.json([...map.values()])
  } catch (e) {
    console.warn('[chats/conversations]', e.message)
    return res.json([])
  }
})

// GET /api/chats/:phone — full chat history for a phone (admin only)
router.get('/:phone', requireAdmin, async (req, res) => {
  const phone = toIntlPhone(req.params.phone) || req.params.phone
  try {
    if (!supabase) return res.json([])
    const { data, error } = await supabase
      .from('chats')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: true })
      .limit(300)
    if (error) throw error
    return res.json(data || [])
  } catch (e) {
    console.warn('[chats GET]', e.message)
    return res.json([])
  }
})

// POST /api/chats/send — admin sends a WhatsApp message via Green API
router.post('/send', requireAdmin, async (req, res) => {
  const { phone, message } = req.body
  if (!phone || !message?.trim()) return res.status(400).json({ error: 'phone and message required' })

  const to = toIntlPhone(phone)
  if (!to) return res.status(400).json({ error: 'invalid phone number' })

  if (!GREEN_INSTANCE || !GREEN_TOKEN) {
    return res.status(500).json({ error: 'Green API not configured — add WA_GREENAPI_INSTANCE and WA_GREENAPI_TOKEN to Render env vars' })
  }

  try {
    const url = `${GREEN_BASE_URL}/waInstance${GREEN_INSTANCE}/sendMessage/${GREEN_TOKEN}`
    const resp = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chatId: `${to}@c.us`, message: message.trim() }),
    })
    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      throw new Error(`Green API ${resp.status}: ${body}`)
    }
    await saveChatMessage(to, 'out', message.trim())
    return res.json({ ok: true })
  } catch (e) {
    console.error('[chats/send]', e.message)
    return res.status(500).json({ error: e.message })
  }
})

// POST /api/chats/webhook — Green API webhook receiver (incoming messages)
// Configure this URL in your Green API console → Webhook URL
router.post('/webhook', async (req, res) => {
  // Respond 200 immediately so Green API doesn't retry
  res.status(200).json({ ok: true })

  const body = req.body
  if (!body?.typeWebhook) return

  try {
    if (body.typeWebhook === 'incomingMessageReceived') {
      const chatId = body.senderData?.chatId || ''
      if (chatId.includes('@g.us')) return // skip group chats for now
      const phone = chatId.replace('@c.us', '')
      const text = body.messageData?.textMessageData?.textMessage
                || body.messageData?.extendedTextMessageData?.text
                || ''
      if (phone && text) {
        await saveChatMessage(phone, 'in', text)
        console.log(`[webhook] ← ${phone}: ${text.slice(0, 80)}`)
      }
    } else if (body.typeWebhook === 'outgoingMessageStatus') {
      // Future: update message status (sent/delivered/read) in DB
      console.log('[webhook] outgoing status:', body.status, body.chatId)
    } else if (body.typeWebhook === 'stateInstanceChanged') {
      console.log('[webhook] instance state:', body.stateInstance)
    }
  } catch (e) {
    console.error('[webhook]', e.message)
  }
})

// PATCH /api/chats/status — update lead_status in contacts table
router.patch('/status', requireAdmin, async (req, res) => {
  const { phone, status } = req.body
  if (!phone || !status) return res.status(400).json({ error: 'phone and status required' })
  try {
    if (!supabase) return res.json({ ok: true })
    const to = toIntlPhone(phone) || phone
    const altPhone = to.startsWith('972') ? '0' + to.slice(3) : null
    await supabase.from('contacts').update({ lead_status: status }).eq('phone', to)
    if (altPhone) await supabase.from('contacts').update({ lead_status: status }).eq('phone', altPhone)
    return res.json({ ok: true })
  } catch (e) {
    console.warn('[chats/status PATCH]', e.message)
    return res.status(500).json({ error: e.message })
  }
})

export default router