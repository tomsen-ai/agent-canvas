import { spawn } from 'node:child_process'
import { mkdir, readdir, readFile, stat, copyFile } from 'node:fs/promises'
import { statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import readline from 'node:readline'
import tldrawUtils from '../web/node_modules/@tldraw/utils/dist-cjs/index.js'

const { getIndexAbove } = tldrawUtils
let lastIndex = 'a0'
function nextIndex() {
  lastIndex = getIndexAbove(lastIndex)
  return lastIndex
}

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

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  '.venv',
  '__pycache__',
  '.turbo',
  '.cache',
  'canvas',
])

const IGNORED_FILES = new Set(['.DS_Store', '.gitignore', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock'])

async function scanDirectory(dir, maxDepth = 3, currentDepth = 0) {
  if (currentDepth > maxDepth) return []
  const entries = await readdir(dir, { withFileTypes: true })
  const result = []
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      const children = await scanDirectory(join(dir, entry.name), maxDepth, currentDepth + 1)
      result.push({ name: entry.name, type: 'directory', path: join(dir, entry.name), children })
    } else {
      if (IGNORED_FILES.has(entry.name)) continue
      result.push({ name: entry.name, type: 'file', path: join(dir, entry.name) })
    }
  }
  result.sort((a, b) => {
    if (a.type === b.type) return a.name.localeCompare(b.name)
    return a.type === 'directory' ? -1 : 1
  })
  return result
}

function flattenTree(nodes, basePath, list = [], depth = 0, parent = null) {
  for (const node of nodes) {
    const item = { ...node, depth, relPath: relative(basePath, node.path) || node.name, parent }
    list.push(item)
    if (node.children) {
      flattenTree(node.children, basePath, list, depth + 1, item)
    }
  }
  return list
}

function createArrowShape(snapshot, pageId, startId, endId, start, end) {
  const shapeId = uniqueId(snapshot.store, 'shape', `arrow-${startId}-${endId}-${Date.now()}`)
  snapshot.store[shapeId] = {
    id: shapeId,
    typeName: 'shape',
    type: 'arrow',
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    rotation: 0,
    isLocked: false,
    opacity: 1,
    index: nextIndex(),
    parentId: pageId,
    props: {
      kind: 'elbow',
      labelColor: 'black',
      color: 'black',
      fill: 'none',
      dash: 'draw',
      size: 's',
      arrowheadStart: 'none',
      arrowheadEnd: 'arrow',
      font: 'draw',
      start: { x: start.x - Math.min(start.x, end.x), y: start.y - Math.min(start.y, end.y) },
      end: { x: end.x - Math.min(start.x, end.x), y: end.y - Math.min(start.y, end.y) },
      bend: 0,
      richText: toRichText(''),
      labelPosition: 0.5,
      scale: 1,
      elbowMidPoint: 0.5,
    },
    meta: { agentcanvasGenerated: true },
  }
  return shapeId
}

async function createProjectVisualization(canvasUrl, projectDir, options = {}) {
  const snapshot = await loadSnapshot(canvasUrl)
  if (!snapshot) throw new Error('No canvas snapshot available.')

  const pageId = findCurrentPageId(snapshot)
  if (!pageId) throw new Error('No page found in canvas.')

  const maxDepth = options.maxDepth ?? 3
  const maxFiles = options.maxFiles ?? 80
  const tree = await scanDirectory(projectDir, maxDepth)
  const flat = flattenTree(tree, projectDir).slice(0, maxFiles)

  if (flat.length === 0) {
    throw new Error('No visible files found in project directory.')
  }

  const nodeWidth = 160
  const nodeHeight = 50
  const horizontalGap = 40
  const verticalGap = 16
  const indent = 60
  const framePadding = 40

  const baseX = options.x ?? 0
  const baseY = options.y ?? 0

  // Compute layout: indented tree, relative to frame origin
  const layout = flat.map((item, i) => ({
    ...item,
    index: i,
    x: framePadding + item.depth * indent,
    y: framePadding + i * (nodeHeight + verticalGap),
  }))

  const maxX = Math.max(...layout.map((n) => n.x)) + nodeWidth
  const maxY = layout[layout.length - 1].y + nodeHeight
  const frameW = maxX + framePadding
  const frameH = maxY + framePadding

  // Add a frame that contains the whole visualization
  const frameId = uniqueId(snapshot.store, 'shape', `frame-project-${Date.now()}`)
  snapshot.store[frameId] = {
    id: frameId,
    typeName: 'shape',
    type: 'frame',
    x: baseX,
    y: baseY,
    rotation: 0,
    isLocked: false,
    opacity: 1,
    index: nextIndex(),
    parentId: pageId,
    props: {
      w: frameW,
      h: frameH,
      name: options.title ?? `${relative(resolve('..', projectDir), projectDir) || 'project'} structure`,
      color: 'black',
    },
    meta: { agentcanvasGenerated: true },
  }

  const shapeByPath = new Map()

  for (const item of layout) {
    const shapeId = uniqueId(
      snapshot.store,
      'shape',
      `note-${item.relPath.replace(/[\/\\]/g, '-')}-${Date.now()}-${item.index}`,
    )
    shapeByPath.set(item.relPath, shapeId)
    snapshot.store[shapeId] = {
      id: shapeId,
      typeName: 'shape',
      type: 'note',
      x: item.x,
      y: item.y,
      rotation: 0,
      isLocked: false,
      opacity: 1,
      index: nextIndex(),
      parentId: frameId,
      props: {
        color: item.type === 'directory' ? 'blue' : 'yellow',
        labelColor: 'black',
        size: 's',
        font: 'draw',
        align: 'middle',
        verticalAlign: 'middle',
        growY: 0,
        url: '',
        richText: toRichText(item.name),
        scale: 1,
        textFirstEditedBy: null,
        fontSizeAdjustment: null,
      },
      meta: { agentcanvasGenerated: true, projectPath: item.relPath },
    }
  }

  // Draw arrows from parent to child (coordinates relative to frame)
  for (const item of layout) {
    if (!item.parent) continue
    const parentShapeId = shapeByPath.get(item.parent.relPath)
    const childShapeId = shapeByPath.get(item.relPath)
    if (!parentShapeId || !childShapeId) continue
    const parentNode = snapshot.store[parentShapeId]
    const childNode = snapshot.store[childShapeId]
    const start = { x: parentNode.x + nodeWidth / 2, y: parentNode.y + nodeHeight }
    const end = { x: childNode.x + nodeWidth / 2, y: childNode.y }
    createArrowShape(snapshot, frameId, parentShapeId, childShapeId, start, end)
  }

  await saveSnapshot(canvasUrl, snapshot)
  return { frameId, itemCount: flat.length, projectDir }
}

function parseCodeFile(content, fileName) {
  const ext = extname(fileName).toLowerCase()
  const isTs = ext === '.ts' || ext === '.tsx' || ext === '.mts' || ext === '.cts'
  const isJs = ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs'
  if (!isTs && !isJs) {
    return []
  }

  const items = []

  // Class declarations
  const classRegex = /(?:export\s+(?:default\s+)?)?class\s+(\w+)/g
  let match
  while ((match = classRegex.exec(content)) !== null) {
    items.push({ name: match[1], kind: 'class' })
  }

  // Function declarations: function name(...) or export function name(...)
  const functionRegex = /(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+(\w+)\s*\(/g
  while ((match = functionRegex.exec(content)) !== null) {
    items.push({ name: match[1], kind: 'function' })
  }

  // Const/Let function assignments: const name = (...) => or const name = async (...) =>
  const arrowRegex = /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|\w+)\s*=>/g
  while ((match = arrowRegex.exec(content)) !== null) {
    // Avoid matching React components twice if already caught by function regex
    if (!items.some((i) => i.name === match[1])) {
      items.push({ name: match[1], kind: 'function' })
    }
  }

  // TypeScript interfaces
  if (isTs) {
    const interfaceRegex = /(?:export\s+)?interface\s+(\w+)/g
    while ((match = interfaceRegex.exec(content)) !== null) {
      items.push({ name: match[1], kind: 'interface' })
    }
    const typeRegex = /(?:export\s+)?type\s+(\w+)\s*=/g
    while ((match = typeRegex.exec(content)) !== null) {
      items.push({ name: match[1], kind: 'type' })
    }
  }

  return items.slice(0, 40)
}

function colorForKind(kind) {
  switch (kind) {
    case 'class':
      return 'blue'
    case 'interface':
    case 'type':
      return 'green'
    case 'function':
      return 'yellow'
    default:
      return 'light-gray'
  }
}

async function createFileVisualization(canvasUrl, filePath, options = {}) {
  const snapshot = await loadSnapshot(canvasUrl)
  if (!snapshot) throw new Error('No canvas snapshot available.')

  const pageId = findCurrentPageId(snapshot)
  if (!pageId) throw new Error('No page found in canvas.')

  const absPath = resolve(filePath)
  const fileStat = await stat(absPath)
  if (!fileStat.isFile()) throw new Error(`Not a file: ${filePath}`)

  const content = await readFile(absPath, 'utf8')
  const fileName = absPath.split(sep).pop() ?? 'file'
  const maxSymbols = options.maxSymbols ?? 20
  const items = parseCodeFile(content, fileName).slice(0, maxSymbols)

  if (items.length === 0) {
    throw new Error('No functions, classes or types found in this file.')
  }

  const nodeWidth = 180
  const nodeHeight = 60
  const horizontalGap = 24
  const verticalGap = 20
  const framePadding = 40
  const nodesPerRow = 3

  const baseX = options.x ?? 0
  const baseY = options.y ?? 0
  const rows = Math.ceil(items.length / nodesPerRow)
  const frameW = framePadding * 2 + nodesPerRow * (nodeWidth + horizontalGap) - horizontalGap
  const frameH = framePadding * 2 + rows * (nodeHeight + verticalGap) - verticalGap

  const frameId = uniqueId(snapshot.store, 'shape', `frame-file-${Date.now()}`)
  snapshot.store[frameId] = {
    id: frameId,
    typeName: 'shape',
    type: 'frame',
    x: baseX,
    y: baseY,
    rotation: 0,
    isLocked: false,
    opacity: 1,
    index: nextIndex(),
    parentId: pageId,
    props: {
      w: frameW,
      h: frameH,
      name: options.title ?? fileName,
      color: 'black',
    },
    meta: { agentcanvasGenerated: true },
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const row = Math.floor(i / nodesPerRow)
    const col = i % nodesPerRow
    const shapeId = uniqueId(snapshot.store, 'shape', `note-${fileName}-${item.name}-${Date.now()}-${i}`)
    const x = framePadding + col * (nodeWidth + horizontalGap)
    const y = framePadding + row * (nodeHeight + verticalGap)
    snapshot.store[shapeId] = {
      id: shapeId,
      typeName: 'shape',
      type: 'note',
      x,
      y,
      rotation: 0,
      isLocked: false,
      opacity: 1,
      index: nextIndex(),
      parentId: frameId,
      props: {
        color: colorForKind(item.kind),
        labelColor: 'black',
        size: 'm',
        font: 'draw',
        align: 'middle',
        verticalAlign: 'middle',
        growY: 0,
        url: '',
        richText: toRichText(`${item.name}`),
        scale: 1,
        textFirstEditedBy: null,
        fontSizeAdjustment: null,
      },
      meta: { agentcanvasGenerated: true, kind: item.kind },
    }
  }

  await saveSnapshot(canvasUrl, snapshot)
  return { frameId, itemCount: items.length, filePath: absPath }
}

const CODE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'])

async function scanCodeFiles(dir, maxDepth = 4, currentDepth = 0) {
  if (currentDepth > maxDepth) return []
  const entries = await readdir(dir, { withFileTypes: true })
  const result = []
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      const children = await scanCodeFiles(join(dir, entry.name), maxDepth, currentDepth + 1)
      result.push(...children)
    } else {
      const ext = extname(entry.name).toLowerCase()
      if (CODE_EXTENSIONS.has(ext)) {
        result.push(join(dir, entry.name))
      }
    }
  }
  return result
}

function extractImports(content) {
  const imports = []

  // ES imports: import ... from './path' or import './path'
  const esRegex = /import\s+(?:(?:\{[^}]*\}|[^'"{}]*?)\s+from\s+)?['"]([^'"]+)['"];?/g
  let match
  while ((match = esRegex.exec(content)) !== null) {
    imports.push(match[1])
  }

  // CommonJS: require('./path')
  const cjsRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  while ((match = cjsRegex.exec(content)) !== null) {
    imports.push(match[1])
  }

  return imports.filter((p) => p.startsWith('.') && !p.endsWith('.css') && !p.endsWith('.scss') && !p.endsWith('.less'))
}

function resolveImportPath(importPath, fromFile, projectDir) {
  const fromDir = dirname(fromFile)
  let resolved = resolve(fromDir, importPath)
  const extensions = ['', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '/index.js', '/index.ts', '/index.jsx', '/index.tsx']
  for (const ext of extensions) {
    const candidate = resolved + ext
    try {
      const s = statSync(candidate)
      if (s.isFile()) {
        return relative(projectDir, candidate)
      }
    } catch {
      // continue
    }
  }
  return null
}

async function createDependencyVisualization(canvasUrl, projectDir, options = {}) {
  const snapshot = await loadSnapshot(canvasUrl)
  if (!snapshot) throw new Error('No canvas snapshot available.')

  const pageId = findCurrentPageId(snapshot)
  if (!pageId) throw new Error('No page found in canvas.')

  const maxFiles = options.maxFiles ?? 40
  const codeFiles = (await scanCodeFiles(projectDir)).slice(0, maxFiles)

  if (codeFiles.length === 0) {
    throw new Error('No JS/TS files found in project directory.')
  }

  const fileNodes = []
  for (const filePath of codeFiles) {
    const relPath = relative(projectDir, filePath)
    const content = await readFile(filePath, 'utf8')
    const imports = extractImports(content)
      .map((p) => resolveImportPath(p, filePath, projectDir))
      .filter(Boolean)
    fileNodes.push({ relPath, filePath, imports })
  }

  const nodeWidth = 180
  const nodeHeight = 50
  const horizontalGap = 80
  const verticalGap = 24
  const framePadding = 40
  const nodesPerRow = 4

  const baseX = options.x ?? 0
  const baseY = options.y ?? 0
  const rows = Math.ceil(fileNodes.length / nodesPerRow)
  const frameW = framePadding * 2 + nodesPerRow * (nodeWidth + horizontalGap) - horizontalGap
  const frameH = framePadding * 2 + rows * (nodeHeight + verticalGap) - verticalGap

  const frameId = uniqueId(snapshot.store, 'shape', `frame-deps-${Date.now()}`)
  snapshot.store[frameId] = {
    id: frameId,
    typeName: 'shape',
    type: 'frame',
    x: baseX,
    y: baseY,
    rotation: 0,
    isLocked: false,
    opacity: 1,
    index: nextIndex(),
    parentId: pageId,
    props: {
      w: frameW,
      h: frameH,
      name: options.title ?? 'module dependencies',
      color: 'black',
    },
    meta: { agentcanvasGenerated: true },
  }

  const shapeByPath = new Map()

  for (let i = 0; i < fileNodes.length; i++) {
    const node = fileNodes[i]
    const row = Math.floor(i / nodesPerRow)
    const col = i % nodesPerRow
    const shapeId = uniqueId(snapshot.store, 'shape', `note-dep-${node.relPath.replace(/[\/\\]/g, '-')}-${Date.now()}-${i}`)
    const x = framePadding + col * (nodeWidth + horizontalGap)
    const y = framePadding + row * (nodeHeight + verticalGap)
    shapeByPath.set(node.relPath, shapeId)
    snapshot.store[shapeId] = {
      id: shapeId,
      typeName: 'shape',
      type: 'note',
      x,
      y,
      rotation: 0,
      isLocked: false,
      opacity: 1,
      index: nextIndex(),
      parentId: frameId,
      props: {
        color: node.relPath.startsWith('node_modules') ? 'gray' : 'blue',
        labelColor: 'black',
        size: 's',
        font: 'draw',
        align: 'middle',
        verticalAlign: 'middle',
        growY: 0,
        url: '',
        richText: toRichText(node.relPath),
        scale: 1,
        textFirstEditedBy: null,
        fontSizeAdjustment: null,
      },
      meta: { agentcanvasGenerated: true, relPath: node.relPath },
    }
  }

  // Draw dependency arrows (coordinates relative to frame)
  for (const node of fileNodes) {
    const fromShapeId = shapeByPath.get(node.relPath)
    if (!fromShapeId) continue
    const fromNode = snapshot.store[fromShapeId]
    for (const depRelPath of node.imports) {
      const toShapeId = shapeByPath.get(depRelPath)
      if (!toShapeId || toShapeId === fromShapeId) continue
      const toNode = snapshot.store[toShapeId]
      const start = { x: fromNode.x + nodeWidth / 2, y: fromNode.y + nodeHeight / 2 }
      const end = { x: toNode.x + nodeWidth / 2, y: toNode.y + nodeHeight / 2 }
      createArrowShape(snapshot, frameId, fromShapeId, toShapeId, start, end)
    }
  }

  await saveSnapshot(canvasUrl, snapshot)
  return { frameId, itemCount: fileNodes.length, projectDir }
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
    index: nextIndex(),
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
    index: nextIndex(),
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
    description: 'Open the AgentCanvas whiteboard for the current project. Starts a local server and returns the browser URL. Call this first whenever the user wants to view, edit, or share the canvas.',
    annotations: { title: 'Open AgentCanvas', readOnlyHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        projectDir: projectDirProperty,
      },
    },
  },
  {
    name: 'canvas_add_text',
    description: 'Add a text note to the AgentCanvas whiteboard. Use this proactively when the user asks to take a note, label something, or summarize on the canvas. The server starts automatically if needed.',
    annotations: { title: 'Add text note', readOnlyHint: false },
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
    description: 'Copy a local image file into the AgentCanvas whiteboard. Use this proactively when the user mentions a screenshot, diagram, or local image they want on the canvas. The server starts automatically if needed.',
    annotations: { title: 'Add image', readOnlyHint: false },
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
    description: 'List the shapes currently on the AgentCanvas whiteboard. Use this when the user asks what is already drawn.',
    annotations: { title: 'List canvas shapes', readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        projectDir: projectDirProperty,
      },
    },
  },
  {
    name: 'canvas_clear',
    description: 'Remove all shapes from the current AgentCanvas page. Use only when the user explicitly asks to clear or reset the canvas.',
    annotations: { title: 'Clear canvas', readOnlyHint: false, destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        projectDir: projectDirProperty,
      },
    },
  },
  {
    name: 'canvas_visualize_project',
    description: 'Visualize the current project directory structure on the AgentCanvas whiteboard. Creates a frame containing notes for directories and files, connected by parent-child arrows. Use this proactively when the user asks about project structure, codebase overview, or how files are organized.',
    annotations: { title: 'Visualize project structure', readOnlyHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        projectDir: projectDirProperty,
        maxDepth: { type: 'number', description: 'Maximum directory depth to scan (default 3).' },
        maxFiles: { type: 'number', description: 'Maximum number of files/directories to show (default 80).' },
        x: { type: 'number', description: 'X coordinate for the top-left of the visualization.' },
        y: { type: 'number', description: 'Y coordinate for the top-left of the visualization.' },
      },
    },
  },
  {
    name: 'canvas_visualize_file',
    description: 'Visualize the structure of a code file on the AgentCanvas whiteboard. Extracts functions, classes, interfaces and types and draws them as notes inside a frame. Use this proactively when the user wants to understand a specific file or asks what is inside a code file.',
    annotations: { title: 'Visualize code file', readOnlyHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path to the code file.' },
        projectDir: projectDirProperty,
        x: { type: 'number', description: 'X coordinate for the top-left of the visualization.' },
        y: { type: 'number', description: 'Y coordinate for the top-left of the visualization.' },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'canvas_visualize_dependencies',
    description: 'Visualize import dependencies between JS/TS files in the current project. Draws files as notes inside a frame and import relationships as arrows. Use this proactively when the user asks about dependencies, module graph, what imports what, or coupling between files.',
    annotations: { title: 'Visualize module dependencies', readOnlyHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        projectDir: projectDirProperty,
        maxFiles: { type: 'number', description: 'Maximum number of files to include (default 40).' },
        x: { type: 'number', description: 'X coordinate for the top-left of the visualization.' },
        y: { type: 'number', description: 'Y coordinate for the top-left of the visualization.' },
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

  async canvas_visualize_project(args) {
    const projectDir = resolveProjectDir(args)
    const canvasUrl = await resolveCanvasUrl(args)
    const result = await createProjectVisualization(canvasUrl, projectDir, args)
    return {
      content: [
        {
          type: 'text',
          text: `Visualized ${result.itemCount} files/directories from ${result.projectDir} in frame ${result.frameId}.`,
        },
      ],
      ...result,
    }
  },

  async canvas_visualize_file(args) {
    const canvasUrl = await resolveCanvasUrl(args)
    const result = await createFileVisualization(canvasUrl, args.filePath, args)
    return {
      content: [
        {
          type: 'text',
          text: `Visualized ${result.itemCount} symbols from ${result.filePath} in frame ${result.frameId}.`,
        },
      ],
      ...result,
    }
  },

  async canvas_visualize_dependencies(args) {
    const projectDir = resolveProjectDir(args)
    const canvasUrl = await resolveCanvasUrl(args)
    const result = await createDependencyVisualization(canvasUrl, projectDir, args)
    return {
      content: [
        {
          type: 'text',
          text: `Visualized ${result.itemCount} files and their import dependencies in frame ${result.frameId}.`,
        },
      ],
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
