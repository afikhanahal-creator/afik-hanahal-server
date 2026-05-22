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

export async function saveChatMessage(phone, direction, message) {
  if (!supabase) return
  const to = toIntlPhone(phone) || phone
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
