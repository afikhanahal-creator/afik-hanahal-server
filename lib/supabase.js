import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_KEY

if (!url || !key) {
  console.warn('[supabase] SUPABASE_URL or SUPABASE_SERVICE_KEY not set — Supabase disabled')
}

export const supabase = (url && key)
  ? createClient(url, key, { auth: { persistSession: false } })
  : null
