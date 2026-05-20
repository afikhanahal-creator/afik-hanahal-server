import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import propertiesRouter from './routes/properties.js'
import contactsRouter  from './routes/contacts.js'
import newsRouter      from './routes/news.js'
import statsRouter     from './routes/stats.js'
import whatsappRouter  from './routes/whatsapp.js'
import capiRouter      from './routes/capi.js'
import aiRouter        from './routes/ai.js'

const app = express()

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map(s => s.trim())

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (server-to-server, Render health checks)
    if (!origin) return cb(null, true)
    if (allowedOrigins.includes(origin)) return cb(null, true)
    cb(new Error(`CORS: ${origin} not allowed`))
  },
  credentials: true,
}))

app.use(express.json({ limit: '5mb' }))

app.get('/health', (_, res) => res.json({ status: 'ok', ts: Date.now() }))

app.use('/api/properties', propertiesRouter)
app.use('/api/contacts',   contactsRouter)
app.use('/api/news',       newsRouter)
app.use('/api/stats',      statsRouter)
app.use('/api/whatsapp',   whatsappRouter)
app.use('/api/capi',       capiRouter)
app.use('/api/ai',         aiRouter)

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`[server] listening on port ${PORT}`))
