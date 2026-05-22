import { Router } from 'express'
import { supabase } from '../lib/supabase.js'
import { sendWAFollowUp, sendAdminEmail } from '../lib/notifications.js'

const router = Router()
let memContacts = []   // in-memory fallback when Supabase is unreachable

function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim()
  if (token !== process.env.ADMIN_TOKEN) return res.status(401).json({ error: 'Unauthorized' })
  next()
}

// POST /api/contacts — save a lead (public endpoint)
router.post('/', async (req, res) => {
  const { name, phone, email, msg, propTitle, propLocation, source, followupMessage } = req.body
  if (!name && !phone) return res.status(400).json({ error: 'name or phone required' })

  const record = {
    name,
    phone,
    email,
    message:       msg,
    prop_title:    propTitle,
    prop_location: propLocation,
    source:        source || 'website',
    created_at:    new Date().toISOString(),
  }

  // 1. Save to Supabase (with in-memory fallback)
  try {
    if (!supabase) throw new Error('Supabase not configured')
    const { error } = await supabase.from('contacts').insert([record])
    if (error) throw error
    console.log('[contacts] saved to Supabase')
  } catch (e) {
    console.warn('[contacts] Supabase unavailable, using memory:', e.message)
    memContacts.unshift({ ...record, id: Date.now() })
    if (memContacts.length > 1000) memContacts = memContacts.slice(0, 1000)
  }

  // Respond immediately — notifications fire in background
  res.status(201).json({ ok: true })

  const lead = { name, phone, email, msg, propTitle, propLocation, source, followupMessage }

  // 2. WhatsApp follow-up — delayed by WA_FOLLOWUP_DELAY_MIN (default 2 min)
  const delayMin = Number(process.env.WA_FOLLOWUP_DELAY_MIN) || 2
  setTimeout(
    () => sendWAFollowUp(lead).catch(e => console.error('[WA followup]', e.message)),
    delayMin * 60 * 1000
  )

  // 3. Immediate admin email notification
  sendAdminEmail(lead).catch(e => console.error('[email notification]', e.message))
})

// POST /api/contacts/test-email — admin only: send a test email and return result
router.post('/test-email', requireAdmin, async (req, res) => {
  const lead = { name: 'בדיקה', phone: '0559811814', email: 'test@example.com', msg: 'הודעת בדיקה — מערכת אפיק הנחל', propTitle: 'נכס בדיקה', propLocation: 'כפר סבא', source: 'admin-test' }
  try {
    await sendAdminEmail(lead)
    return res.json({ ok: true })
  } catch (e) {
    console.error('[test-email]', e.message)
    return res.status(500).json({ ok: false, error: e.message })
  }
})

// POST /api/contacts/test-wa — admin only: immediately send a WA test and return result
router.post('/test-wa', requireAdmin, async (req, res) => {
  const phone = req.body?.phone || '0559811814'
  const lead = { name: 'בדיקה', phone, msg: 'הודעת בדיקה', propTitle: '', propLocation: '' }
  try {
    await sendWAFollowUp(lead)
    return res.json({ ok: true, sentTo: phone })
  } catch (e) {
    console.error('[test-wa]', e.message)
    return res.status(500).json({ ok: false, error: e.message })
  }
})

// GET /api/contacts — admin only
router.get('/', requireAdmin, async (req, res) => {
  try {
    if (!supabase) throw new Error('Supabase not configured')
    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1000)
    if (error) throw error
    return res.json(data)
  } catch (e) {
    console.warn('[contacts GET] Supabase unavailable, returning memory:', e.message)
    return res.json(memContacts)
  }
})

export default router
