import { Router } from 'express'

const router = Router()

function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim()
  if (token !== process.env.ADMIN_TOKEN) return res.status(401).json({ error: 'Unauthorized' })
  next()
}

// POST /api/ai/messages — admin-only proxy to Anthropic
// Removes the need to expose ANTHROPIC_API_KEY in the browser bundle.
router.post('/messages', requireAdmin, async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'AI not configured on server' })

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': req.headers['anthropic-version'] || '2023-06-01',
      },
      body: JSON.stringify(req.body),
    })
    const data = await response.json()
    res.status(response.ok ? 200 : response.status).json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
