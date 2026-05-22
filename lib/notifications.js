// ── Shared notification helpers ───────────────────────────────────────────────
// Sends WhatsApp follow-up (Green API) and admin email (Gmail) when a new lead
// is received via the contact form.

import nodemailer from 'nodemailer'
import { saveChatMessage } from './chats.js'

// ── WhatsApp follow-up via Green API ─────────────────────────────────────────
// Requires Render env vars:
//   WA_GREENAPI_INSTANCE  – idInstance from green-api.com dashboard
//   WA_GREENAPI_TOKEN     – apiTokenInstance from green-api.com dashboard
//   WA_GREENAPI_URL       – optional base URL (default: https://api.green-api.com)
//   WA_FOLLOWUP_TEMPLATE  – optional message text, supports {name} placeholder
//   WA_FOLLOWUP_DELAY_MIN – delay in minutes before sending (default: 2)

const GREEN_INSTANCE = process.env.WA_GREENAPI_INSTANCE
const GREEN_TOKEN    = process.env.WA_GREENAPI_TOKEN
const GREEN_BASE_URL = (process.env.WA_GREENAPI_URL || 'https://api.green-api.com').replace(/\/$/, '')

const DEFAULT_TEMPLATE = `היי {name} 👋
תודה שפנית לאפיק הנחל!
ראינו את הפנייה שלך ונציג שלנו יחזור אליך בהקדם 🏡
לכל שאלה דחופה: 055-981-1814`

const FOLLOWUP_TEMPLATE = process.env.WA_FOLLOWUP_TEMPLATE || DEFAULT_TEMPLATE

function toIntlPhone(phone) {
  const d = (phone || '').replace(/\D/g, '')
  if (!d) return ''
  if (d.startsWith('972')) return d
  if (d.startsWith('0'))   return '972' + d.slice(1)
  return d
}

export async function sendWAFollowUp(lead) {
  if (!GREEN_INSTANCE || !GREEN_TOKEN) {
    console.warn('[WA followup] skipping — WA_GREENAPI_INSTANCE or WA_GREENAPI_TOKEN not set')
    return
  }
  if (!lead.phone) {
    console.warn('[WA followup] skipping — lead has no phone')
    return
  }

  const to = toIntlPhone(lead.phone)
  if (!to) {
    console.warn('[WA followup] could not parse phone:', lead.phone)
    return
  }

  const baseTemplate = lead.followupMessage || FOLLOWUP_TEMPLATE
  const message = baseTemplate
    .replace(/\{name\}/g, lead.name || '')
    .replace(/\{propTitle\}/g, lead.propTitle || lead.prop_title || '')

  const url = `${GREEN_BASE_URL}/waInstance${GREEN_INSTANCE}/sendMessage/${GREEN_TOKEN}`
  console.log(`[WA followup] → ${to} | base: ${GREEN_BASE_URL} | instance: ${GREEN_INSTANCE}`)

  let respText = ''
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: `${to}@c.us`, message }),
      signal: AbortSignal.timeout(15000),
    })
    respText = await resp.text().catch(() => '')
    console.log(`[WA followup] Green API response ${resp.status}: ${respText.slice(0, 200)}`)
    if (!resp.ok) {
      throw new Error(`Green API ${resp.status}: ${respText}`)
    }
  } catch (e) {
    if (e.name === 'TimeoutError') console.error('[WA followup] request timed out (15s)')
    throw e
  }

  let parsed
  try { parsed = JSON.parse(respText) } catch {}
  if (parsed?.idMessage) {
    console.log(`[WA followup] ✓ delivered to ${to}, idMessage: ${parsed.idMessage}`)
  } else {
    console.warn(`[WA followup] no idMessage in response — delivery unconfirmed`)
  }

  await saveChatMessage(to, 'out', message).catch(() => {})
}

// ── Admin email notification via Gmail SMTP ───────────────────────────────────
// Requires Render env vars:
//   GMAIL_USER         – sender Gmail address (e.g. afik.hanahal@gmail.com)
//   GMAIL_APP_PASSWORD – 16-char App Password from Google Account → Security → App Passwords
//   ADMIN_NOTIFY_EMAIL – recipient, defaults to afik.hanahal@gmail.com

const ADMIN_NOTIFY_EMAIL = process.env.ADMIN_NOTIFY_EMAIL || 'afik.hanahal@gmail.com'

let _transporter = null
function getTransporter() {
  if (_transporter) return _transporter
  const user = process.env.GMAIL_USER
  const pass = process.env.GMAIL_APP_PASSWORD
  if (!user || !pass) return null
  _transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  })
  return _transporter
}

export async function sendAdminEmail(lead) {
  const transporter = getTransporter()
  if (!transporter) {
    console.warn('[email] GMAIL_USER / GMAIL_APP_PASSWORD not set — skipping email notification')
    return
  }

  const { name, phone, email, msg, propTitle, propLocation, source } = lead
  const now = new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })

  const html = `
<div dir="rtl" style="font-family:Arial,sans-serif;max-width:540px;background:#f9f9f9;padding:24px;border-radius:8px">
  <div style="background:#8490D8;color:#fff;padding:16px 20px;border-radius:6px 6px 0 0;margin-bottom:0">
    <h2 style="margin:0;font-size:18px">ליד חדש — אפיק הנחל</h2>
    <div style="font-size:12px;opacity:.8;margin-top:4px">${now}</div>
  </div>
  <table style="border-collapse:collapse;width:100%;background:#fff;border-radius:0 0 6px 6px">
    ${row('שם',       name        || '—')}
    ${row('טלפון',    phone       || '—')}
    ${row('אימייל',   email       || '—')}
    ${row('נכס',      propTitle ? propTitle + (propLocation ? ' — ' + propLocation : '') : '—')}
    ${row('הודעה',    msg         || '—')}
    ${row('מקור',     source      || 'website')}
  </table>
  <div style="margin-top:14px;font-size:11px;color:#999;text-align:center">
    הודעה זו נשלחה אוטומטית ממערכת אפיק הנחל
  </div>
</div>`

  function row(label, value) {
    return `<tr>
      <td style="padding:10px 16px;background:#f5f5f5;font-weight:bold;font-size:13px;width:30%;border-bottom:1px solid #eee">${label}</td>
      <td style="padding:10px 16px;font-size:13px;border-bottom:1px solid #eee">${value}</td>
    </tr>`
  }

  await transporter.sendMail({
    from:    `"אפיק הנחל — אתר" <${process.env.GMAIL_USER}>`,
    to:      ADMIN_NOTIFY_EMAIL,
    subject: `ליד חדש: ${name || phone || 'לקוח חדש'} — אפיק הנחל`,
    html,
    text: `ליד חדש — אפיק הנחל\n\nשם: ${name || '—'}\nטלפון: ${phone || '—'}\nאימייל: ${email || '—'}\nנכס: ${propTitle || '—'}\nהודעה: ${msg || '—'}\nמקור: ${source || 'website'}\nזמן: ${now}`,
  })
  console.log('[email] admin notification sent to', ADMIN_NOTIFY_EMAIL)
}
