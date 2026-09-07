// Shared helper — saves WhatsApp messages to Supabase chats table
// Imported by both routes/chats.js and lib/notifications.js
import { supabase } from './supabase.js'

export function toIntlPhone(phone) {
  const d = (phone || '').replace(/\D/g, '')
  if (!d) return ''
  if (d.startsWith('972')) return d
  if (d.startsWith('0'))   return '972' + d.slice(1)
  return d
}

// Tiny read cache: the admin panel polls conversations and the open chat every few seconds and
// each poll used to hit Supabase (metered egress). Entries live 20 s and are dropped the moment a
// message is saved, so the panel still sees new messages at once.
const CHAT_CACHE_MS = 20000
const chatCache = new Map()
export function cacheGet(key) { const e = chatCache.get(key); if (e && Date.now() - e.at < CHAT_CACHE_MS) return e.data; chatCache.delete(key); return undefined }
export function cacheSet(key, data) { chatCache.set(key, { at: Date.now(), data }); if (chatCache.size > 500) chatCache.delete(chatCache.keys().next().value) }
export function cacheBust(phone) { chatCache.delete('conversations'); if (phone) chatCache.delete(`phone:${phone}`) }

export async function saveChatMessage(phone, direction, message) {
  if (!supabase) return
  const to = toIntlPhone(phone) || phone
  cacheBust(to)
  try {
    await supabase.from('chats').insert([{
      phone:     to,
      direction, // 'in' | 'out'
      message,
      status:    direction === 'in' ? 'received' : 'sent',
    }])
  } catch (e) {
    console.warn('[chats] saveChatMessage failed:', e.message)
  }
}
