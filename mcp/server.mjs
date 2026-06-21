import { spawn } from 'node:child_process'
import { mkdir, readFile, stat, copyFile } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import readline from 'node:readline'

const SERVER_NAME = 'AgentCanvas MCP'
const SERVER_VERSION = '0.1.0'
const DEFAULT_PORT = 43217

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function sendResult(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

function sendError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function resolveProjectDir(args = {}) {
  return resolve(
    nonEmptyString(args.projectDir) ??
      process.env.AGENTCANVAS_PROJECT_DIR ??
      process.env.CANVAS_PROJECT_DIR ??
      process.cwd(),
  )
}

function resolveCanvasDir(projectDir) {
  return resolve(projectDir, process.env.AGENTCANVAS_CANVAS_DIR ?? 'canvas')
}

function resolveServerScript() {
  return resolve(import.meta.dirname, '../server/index.mjs')
}

let runningServer = null
const callQueue = []
let callQueueRunning = false

async function runQueued(fn) {
  return new Promise((resolve, reject) => {
    callQueue.push(async () => {
      try {
        resolve(await fn())
      } catch (error) {
        reject(error)
      }
    })
    if (!callQueueRunning) processQueue()
  })
}

async function processQueue() {
  callQueueRunning = true
  while (callQueue.length > 0) {
    const next = callQueue.shift()
    try {
      await next()
    } catch {
      // errors are handled by the promise reject/resolve above
    }
  }
  callQueueRunning = false
}

async function ensureServer(projectDir) {
  const port = runningServer?.port ?? DEFAULT_PORT
  const url = `http://127.0.0.1:${port}`

  try {
    const res = await fetch(`${url}/api/canvas`, { signal: AbortSignal.timeout(1000) })
    if (res.ok) return { url, port, alreadyRunning: true }
  } catch {
    // not running, start it
  }

  if (runningServer?.process && !runningServer.process.killed) {
    runningServer.process.kill()
  }

  const proc = spawn('node', [resolveServerScript()], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      AGENTCANVAS_PROJECT_DIR: projectDir,
      AGENTCANVAS_PORT: String(port),
    },
  })

  runningServer = { process: proc, port, projectDir }

  proc.stdout.on('data', (data) => {
    console.error(`[AgentCanvas server] ${data.toString().trim()}`)
  })
  proc.stderr.on('data', (data) => {
    console.error(`[AgentCanvas server] ${data.toString().trim()}`)
  })

  // Wait for server to be ready
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${url}/api/canvas`, { signal: AbortSignal.timeout(500) })
      if (res.ok) return { url, port, alreadyRunning: false }
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }

  throw new Error('Failed to start AgentCanvas server within 15 seconds.')
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options)
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 500)}`)
  }
  return text ? JSON.parse(text) : {}
}

async function loadSnapshot(canvasUrl) {
  const data = await fetchJson(`${canvasUrl}/api/canvas`)
  return data.snapshot ?? null
}

async function saveSnapshot(canvasUrl, snapshot) {
  return fetchJson(`${canvasUrl}/api/canvas`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(snapshot),
  })
}

function toRichText(text) {
  const lines = String(text).split('\n')
  const content = lines.map((line) => {
    if (!line) return { type: 'paragraph' }
    return { type: 'paragraph', content: [{ type: 'text', text: line }] }
  })
  return { type: 'doc', content }
}

function richTextToPlainText(richText) {
  if (!richText || typeof richText !== 'object' || richText.type !== 'doc') return ''
  const paragraphs = Array.isArray(richText.content) ? richText.content : []
  return paragraphs
    .map((p) => {
      if (!p || !Array.isArray(p.content)) return ''
      return p.content.map((node) => (typeof node?.text === 'string' ? node.text : '')).join('')
    })
    .join('\n')
}

function sanitizeFileName(name) {
  const base = String(name || 'asset')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || 'asset'
}

function uniqueId(store, prefix, seed) {
  const clean = sanitizeFileName(seed).replace(/\./g, '-')
  let candidate = `${prefix}:${clean}`
  let counter = 2
  while (store[candidate]) {
    candidate = `${prefix}:${clean}-${counter}`
    counter++
  }
  return candidate
}

function findCurrentPageId(snapshot) {
  const pages = Object.values(snapshot.store).filter((r) => r.typeName === 'page')
  if (pages.length === 0) return null
  // Prefer page with lowest index, or the only page
  pages.sort((a, b) => String(a.index ?? '').localeCompare(String(b.index ?? '')))
  return pages[0].id
}

async function addTextShape(canvasUrl, text, options = {}) {
  const snapshot = await loadSnapshot(canvasUrl)
  if (!snapshot) throw new Error('No canvas snapshot available.')

  const pageId = findCurrentPageId(snapshot)
  if (!pageId) throw new Error('No page found in canvas.')

  const shapeId = uniqueId(snapshot.store, 'shape', `text-${Date.now()}`)
  const now = Date.now()

  snapshot.store[shapeId] = {
    id: shapeId,
    typeName: 'shape',
    type: 'text',
    x: options.x ?? 0,
    y: options.y ?? 0,
    rotation: 0,
    isLocked: false,
    opacity: 1,
    index: `a1${now}`,
    parentId: pageId,
    props: {
      richText: toRichText(text),
      color: options.color ?? 'black',
      size: options.size ?? 'm',
      w: options.width ?? 200,
      font: 'draw',
      textAlign: 'start',
      autoSize: true,
      scale: 1,
    },
    meta: { agentcanvasGenerated: true },
  }

  await saveSnapshot(canvasUrl, snapshot)
  return { shapeId, pageId }
}

async function addImageShape(canvasUrl, imagePath, options = {}) {
  const snapshot = await loadSnapshot(canvasUrl)
  if (!snapshot) throw new Error('No canvas snapshot available.')

  const pageId = findCurrentPageId(snapshot)
  if (!pageId) throw new Error('No page found in canvas.')

  const absImagePath = resolve(imagePath)
  const fileStat = await stat(absImagePath)
  if (!fileStat.isFile()) throw new Error(`Not a file: ${imagePath}`)

  const ext = extname(absImagePath) || '.png'
  const fileName = `${Date.now()}-${sanitizeFileName(options.fileName ?? `image${ext}`)}`

  const projectDir = runningServer?.projectDir ?? resolveProjectDir(options)
  const canvasDir = resolveCanvasDir(projectDir)
  const assetsDir = join(canvasDir, 'assets')
  const destPath = join(assetsDir, fileName)
  await mkdir(assetsDir, { recursive: true })
  await copyFile(absImagePath, destPath)

  const assetId = uniqueId(snapshot.store, 'asset', fileName)
  snapshot.store[assetId] = {
    id: assetId,
    typeName: 'asset',
    type: 'image',
    props: {
      name: fileName,
      src: `/assets/${fileName}`,
      w: options.width ?? 512,
      h: options.height ?? 512,
      isAnimated: false,
      mimeType: `image/${ext.replace('.', '') || 'png'}`,
      fileSize: fileStat.size,
    },
    meta: {},
  }

  const shapeId = uniqueId(snapshot.store, 'shape', `image-${Date.now()}`)
  snapshot.store[shapeId] = {
    id: shapeId,
    typeName: 'shape',
    type: 'image',
    x: options.x ?? 0,
    y: options.y ?? 0,
    rotation: 0,
    isLocked: false,
    opacity: 1,
    index: `a1${Date.now()}`,
    parentId: pageId,
    props: {
      w: options.width ?? 512,
      h: options.height ?? 512,
      playing: false,
      url: '',
      assetId,
      crop: null,
      flipX: false,
      flipY: false,
      altText: '',
    },
    meta: { agentcanvasGenerated: true },
  }

  await saveSnapshot(canvasUrl, snapshot)
  return { shapeId, assetId, pageId, assetPath: destPath }
}

async function getState(canvasUrl) {
  const snapshot = await loadSnapshot(canvasUrl)
  if (!snapshot) return { empty: true }

  const shapes = Object.values(snapshot.store).filter((r) => r.typeName === 'shape')
  const pages = Object.values(snapshot.store).filter((r) => r.typeName === 'page')

  return {
    pageCount: pages.length,
    shapeCount: shapes.length,
    shapes: shapes.map((s) => ({
      id: s.id,
      type: s.type,
      x: s.x,
      y: s.y,
      text: s.props?.richText ? richTextToPlainText(s.props.richText) : s.props?.text,
      assetId: s.props?.assetId,
    })),
  }
}

async function clearCanvas(canvasUrl) {
  const snapshot = await loadSnapshot(canvasUrl)
  if (!snapshot) return { ok: true }

  const pageId = findCurrentPageId(snapshot)
  if (!pageId) return { ok: true }

  // Remove all shapes that belong to the current page
  for (const id of Object.keys(snapshot.store)) {
    const record = snapshot.store[id]
    if (record?.typeName === 'shape' && record.parentId === pageId) {
      delete snapshot.store[id]
    }
  }

  await saveSnapshot(canvasUrl, snapshot)
  return { ok: true, removedPageId: pageId }
}

const projectDirProperty = {
  type: 'string',
  description: 'Absolute project directory. Defaults to the current working directory.',
}

const TOOLS = [
  {
    name: 'canvas_open',
    description: 'Open the AgentCanvas whiteboard for the current project. Starts a local server and returns the browser URL. Use this first if the user wants to view or edit the canvas.',
    inputSchema: {
      type: 'object',
      properties: {
        projectDir: projectDirProperty,
      },
    },
  },
  {
    name: 'canvas_add_text',
    description: 'Add a text note to the AgentCanvas whiteboard. The server starts automatically if needed.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text content.' },
        x: { type: 'number', description: 'X coordinate on the canvas.' },
        y: { type: 'number', description: 'Y coordinate on the canvas.' },
        color: { type: 'string', description: 'Color name, e.g. black, red, blue.' },
        size: { type: 'string', description: 'Text size: s, m, l, xl.' },
        projectDir: projectDirProperty,
      },
      required: ['text'],
    },
  },
  {
    name: 'canvas_add_image',
    description: 'Copy a local image file into the AgentCanvas whiteboard. The server starts automatically if needed.',
    inputSchema: {
      type: 'object',
      properties: {
        imagePath: { type: 'string', description: 'Absolute path to the image file.' },
        x: { type: 'number', description: 'X coordinate on the canvas.' },
        y: { type: 'number', description: 'Y coordinate on the canvas.' },
        width: { type: 'number', description: 'Display width in pixels.' },
        height: { type: 'number', description: 'Display height in pixels.' },
        projectDir: projectDirProperty,
      },
      required: ['imagePath'],
    },
  },
  {
    name: 'canvas_get_state',
    description: 'List the shapes currently on the AgentCanvas whiteboard.',
    inputSchema: {
      type: 'object',
      properties: {
        projectDir: projectDirProperty,
      },
    },
  },
  {
    name: 'canvas_clear',
    description: 'Remove all shapes from the current AgentCanvas page.',
    inputSchema: {
      type: 'object',
      properties: {
        projectDir: projectDirProperty,
      },
    },
  },
]

async function resolveCanvasUrl(args) {
  const projectDir = resolveProjectDir(args)
  const { url } = await ensureServer(projectDir)
  return url
}

const HANDLERS = {
  async canvas_open(args) {
    const projectDir = resolveProjectDir(args)
    const { url, alreadyRunning } = await ensureServer(projectDir)
    return {
      content: [
        {
          type: 'text',
          text: `AgentCanvas is running at ${url} (${alreadyRunning ? 'already running' : 'started now'}). Open this URL in a browser to view and edit the canvas.`,
        },
      ],
      url,
      projectDir,
    }
  },

  async canvas_add_text(args) {
    const canvasUrl = await resolveCanvasUrl(args)
    const result = await addTextShape(canvasUrl, args.text, args)
    return {
      content: [
        {
          type: 'text',
          text: `Added text shape ${result.shapeId} to page ${result.pageId}.`,
        },
      ],
      ...result,
    }
  },

  async canvas_add_image(args) {
    const canvasUrl = await resolveCanvasUrl(args)
    const result = await addImageShape(canvasUrl, args.imagePath, args)
    return {
      content: [
        {
          type: 'text',
          text: `Added image shape ${result.shapeId} to page ${result.pageId}.`,
        },
      ],
      ...result,
    }
  },

  async canvas_get_state(args) {
    const canvasUrl = await resolveCanvasUrl(args)
    const state = await getState(canvasUrl)
    return {
      content: [{ type: 'text', text: JSON.stringify(state, null, 2) }],
      state,
    }
  },

  async canvas_clear(args) {
    const canvasUrl = await resolveCanvasUrl(args)
    const result = await clearCanvas(canvasUrl)
    return {
      content: [{ type: 'text', text: 'Cleared the current page.' }],
      ...result,
    }
  },
}

async function handleRequest(request) {
  const { id, method, params } = request

  if (method === 'initialize') {
    return {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    }
  }

  if (method === 'notifications/initialized') {
    return null
  }

  if (method === 'tools/list') {
    return { tools: TOOLS }
  }

  if (method === 'tools/call') {
    const name = params?.name
    const args = params?.arguments ?? {}
    const handler = HANDLERS[name]
    if (!handler) {
      throw new Error(`Unknown tool: ${name}`)
    }
    return await runQueued(() => handler(args))
  }

  if (method === 'ping') {
    return {}
  }

  throw new Error(`Unknown method: ${method}`)
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
})

rl.on('line', async (line) => {
  let request
  try {
    request = JSON.parse(line)
  } catch (error) {
    sendError(null, -32700, `Parse error: ${error.message}`)
    return
  }

  const { id, method } = request
  if (!method) {
    sendError(id ?? null, -32600, 'Invalid request: missing method')
    return
  }

  try {
    const result = await handleRequest(request)
    if (id !== undefined && id !== null) {
      sendResult(id, result)
    }
  } catch (error) {
    sendError(id ?? null, -32603, `${error.name}: ${error.message}`)
  }
})

process.on('SIGINT', () => {
  if (runningServer?.process && !runningServer.process.killed) {
    runningServer.process.kill()
  }
  process.exit(0)
})
