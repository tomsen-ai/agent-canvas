import express from 'express'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import {
  loadCanvas,
  saveCanvas,
  loadSelection,
  saveSelection,
  loadViewState,
  saveViewState,
} from './canvas-store.mjs'

export function createApiRouter(canvasDir, eventBroadcast) {
  const router = express.Router()
  let eventVersion = 0

  function broadcast(payload) {
    eventVersion++
    eventBroadcast({ ...payload, version: eventVersion })
  }

  router.use(express.json({ limit: '50mb' }))

  router.get('/canvas', async (req, res) => {
    try {
      const snapshot = await loadCanvas(canvasDir)
      res.json({ snapshot, path: join(canvasDir, 'agentcanvas-canvas.json') })
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })

  router.put('/canvas', async (req, res) => {
    try {
      const snapshot = req.body
      if (!snapshot || typeof snapshot !== 'object' || !snapshot.store || !snapshot.schema) {
        res.status(400).json({ error: 'Expected a tldraw store snapshot.' })
        return
      }
      await saveCanvas(canvasDir, snapshot)
      broadcast({ type: 'canvas-changed', snapshot })
      res.json({ ok: true })
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })

  router.get('/selection', async (req, res) => {
    try {
      const selection = await loadSelection(canvasDir)
      res.json({ selection, path: join(canvasDir, 'agentcanvas-selection.json') })
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })

  router.put('/selection', async (req, res) => {
    try {
      const selection = req.body
      if (!selection || typeof selection !== 'object' || !Array.isArray(selection.selectedShapes)) {
        res.status(400).json({ error: 'Expected a selection state.' })
        return
      }
      await saveSelection(canvasDir, selection)
      broadcast({ type: 'selection-changed', selection })
      res.json({ ok: true })
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })

  router.get('/view-state', async (req, res) => {
    try {
      const viewState = await loadViewState(canvasDir)
      res.json({ viewState, path: join(canvasDir, 'agentcanvas-view-state.json') })
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })

  router.put('/view-state', async (req, res) => {
    try {
      const viewState = req.body
      if (!viewState || typeof viewState !== 'object' || viewState.version !== 1) {
        res.status(400).json({ error: 'Expected a view state.' })
        return
      }
      await saveViewState(canvasDir, viewState)
      res.json({ ok: true })
    } catch (error) {
      res.status(500).json({ error: error.message })
    }
  })

  router.get('/canvas-events', (req, res) => {
    res.setHeader('content-type', 'text/event-stream')
    res.setHeader('cache-control', 'no-cache, no-transform')
    res.setHeader('connection', 'keep-alive')
    res.setHeader('x-accel-buffering', 'no')
    res.write(': connected\n\n')

    const sendEvent = (payload) => {
      res.write(`event: ${payload.type}\n`)
      res.write(`data: ${JSON.stringify(payload)}\n\n`)
    }

    eventBroadcast.addListener(sendEvent)

    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n')
    }, 25000)

    req.on('close', () => {
      clearInterval(heartbeat)
      eventBroadcast.removeListener(sendEvent)
    })
  })

  return router
}

export function createAssetRouter(canvasDir) {
  const router = express.Router()
  const assetsDir = join(canvasDir, 'assets')

  router.get('/:fileName', async (req, res) => {
    try {
      const fileName = req.params.fileName
      const filePath = resolve(assetsDir, fileName)
      if (!filePath.startsWith(resolve(assetsDir))) {
        res.status(403).end('Forbidden')
        return
      }
      const fileStat = await stat(filePath)
      if (!fileStat.isFile()) {
        res.status(404).end('Not found')
        return
      }
      res.setHeader('content-type', 'application/octet-stream')
      res.setHeader('content-length', String(fileStat.size))
      createReadStream(filePath).pipe(res)
    } catch (error) {
      if (error.code === 'ENOENT') {
        res.status(404).end('Not found')
        return
      }
      res.status(500).json({ error: error.message })
    }
  })

  return router
}
