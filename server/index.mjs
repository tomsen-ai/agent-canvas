import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveProjectDir, resolveCanvasDir } from './canvas-store.mjs'
import { createApiRouter, createAssetRouter } from './api-routes.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PORT = Number(process.env.AGENTCANVAS_PORT ?? 43217)
const HOST = process.env.AGENTCANVAS_HOST ?? '127.0.0.1'
const projectDir = resolveProjectDir()
const canvasDir = resolveCanvasDir(projectDir)

const app = express()

const eventBroadcast = {
  listeners: new Set(),
  addListener(fn) {
    this.listeners.add(fn)
  },
  removeListener(fn) {
    this.listeners.delete(fn)
  },
  broadcast(payload) {
    for (const fn of this.listeners) {
      try {
        fn(payload)
      } catch {
        this.listeners.delete(fn)
      }
    }
  },
}

// Rewrite eventBroadcast function calls to use broadcast method
const originalEventBroadcast = eventBroadcast
const eventBroadcastWrapper = Object.assign((payload) => originalEventBroadcast.broadcast(payload), {
  addListener: originalEventBroadcast.addListener.bind(originalEventBroadcast),
  removeListener: originalEventBroadcast.removeListener.bind(originalEventBroadcast),
})

const webDistDir = path.resolve(__dirname, '../web/dist')

app.use('/api', createApiRouter(canvasDir, eventBroadcastWrapper))
app.use(express.static(webDistDir))
app.use('/assets', createAssetRouter(canvasDir))
app.use((req, res) => {
  res.sendFile(path.join(webDistDir, 'index.html'))
})

app.listen(PORT, HOST, () => {
  console.log(`AgentCanvas running at http://${HOST}:${PORT}/`)
  console.log(`Project directory: ${projectDir}`)
  console.log(`Canvas directory: ${canvasDir}`)
})
