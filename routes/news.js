import { Router } from 'express'
import { supabase } from '../lib/supabase.js'

const router = Router()

// POST /api/news/sync — frontend pushes fetched articles for backup storage
router.post('/sync', async (req, res) => {
  const { articles, lang = 'he' } = req.body
  if (!Array.isArray(articles) || !articles.length) {
    return res.status(400).json({ error: 'articles array required' })
  }

  const rows = articles.map(a => ({
    id:           a.id || a.url,
    title:        a.title,
    url:          a.url,
    image:        a.image,
    source:       a.source,
    published_at: a.publishedAt || a.published_at || null,
    lang,
    archived:     false,
  }))

  const { error } = await supabase
    .from('news_articles')
    .upsert(rows, { onConflict: 'id' })

  if (error) return res.status(500).json({ error: error.message })
  res.json({ ok: true, count: rows.length })
})

// GET /api/news — get recent cached articles (fallback when Bing is unavailable)
router.get('/', async (req, res) => {
  const lang = req.query.lang || 'he'
  const { data, error } = await supabase
    .from('news_articles')
    .select('*')
    .eq('lang', lang)
    .eq('archived', false)
    .order('published_at', { ascending: false })
    .limit(20)
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

export default router
