import { mkdir, readFile, writeFile, rename, readdir, stat, copyFile } from 'node:fs/promises'
import { dirname, join, resolve, relative } from 'node:path'

const CANVAS_FILE_NAME = 'agentcanvas-canvas.json'
const SELECTION_FILE_NAME = 'agentcanvas-selection.json'
const VIEW_STATE_FILE_NAME = 'agentcanvas-view-state.json'
const ASSETS_DIR_NAME = 'assets'

export function resolveProjectDir() {
  return resolve(process.env.AGENTCANVAS_PROJECT_DIR ?? process.env.CANVAS_PROJECT_DIR ?? process.cwd())
}

export function resolveCanvasDir(projectDir) {
  return resolve(projectDir, process.env.AGENTCANVAS_CANVAS_DIR ?? 'canvas')
}

function canvasFilePath(canvasDir) {
  return join(canvasDir, CANVAS_FILE_NAME)
}

function selectionFilePath(canvasDir) {
  return join(canvasDir, SELECTION_FILE_NAME)
}

function viewStateFilePath(canvasDir) {
  return join(canvasDir, VIEW_STATE_FILE_NAME)
}

function assetsDirPath(canvasDir) {
  return join(canvasDir, ASSETS_DIR_NAME)
}

async function writeJsonAtomic(filePath, payload) {
  await mkdir(dirname(filePath), { recursive: true })
  const tempFile = `${filePath}.${process.pid}.tmp`
  await writeFile(tempFile, `${JSON.stringify(payload, null, 2)}\n`)
  await rename(tempFile, filePath)
}

async function readJsonFile(filePath) {
  const text = await readFile(filePath, 'utf8')
  return JSON.parse(text)
}

function createDefaultSnapshot() {
  const pageId = 'page:page'
  return {
    store: {
      'document:document': {
        id: 'document:document',
        typeName: 'document',
        gridSize: 10,
        name: '',
        meta: {},
      },
      [pageId]: {
        id: pageId,
        typeName: 'page',
        name: 'Page 1',
        index: 'a1',
        meta: {},
      },
    },
    schema: {
      schemaVersion: 2,
      sequences: {
        'com.tldraw.store': 5,
        'com.tldraw.asset': 1,
        'com.tldraw.asset.image': 6,
        'com.tldraw.asset.video': 5,
        'com.tldraw.asset.bookmark': 2,
        'com.tldraw.camera': 1,
        'com.tldraw.document': 2,
        'com.tldraw.instance': 26,
        'com.tldraw.instance_page_state': 5,
        'com.tldraw.page': 1,
        'com.tldraw.instance_presence': 6,
        'com.tldraw.pointer': 1,
        'com.tldraw.shape': 4,
        'com.tldraw.shape.arrow': 8,
        'com.tldraw.shape.bookmark': 2,
        'com.tldraw.shape.draw': 4,
        'com.tldraw.shape.embed': 4,
        'com.tldraw.shape.frame': 1,
        'com.tldraw.shape.geo': 11,
        'com.tldraw.shape.group': 0,
        'com.tldraw.shape.highlight': 3,
        'com.tldraw.shape.image': 5,
        'com.tldraw.shape.line': 5,
        'com.tldraw.shape.note': 12,
        'com.tldraw.shape.text': 4,
        'com.tldraw.shape.video': 4,
        'com.tldraw.binding.arrow': 1,
        'com.tldraw.user': 1,
      },
    },
  }
}

export async function loadCanvas(canvasDir) {
  try {
    return await readJsonFile(canvasFilePath(canvasDir))
  } catch (error) {
    if (error.code === 'ENOENT') {
      const defaultSnapshot = createDefaultSnapshot()
      await saveCanvas(canvasDir, defaultSnapshot)
      return defaultSnapshot
    }
    throw error
  }
}

export async function saveCanvas(canvasDir, snapshot) {
  await writeJsonAtomic(canvasFilePath(canvasDir), snapshot)
}

export async function loadSelection(canvasDir) {
  try {
    return await readJsonFile(selectionFilePath(canvasDir))
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { selectedShapes: [], updatedAt: null }
    }
    throw error
  }
}

export async function saveSelection(canvasDir, selection) {
  await writeJsonAtomic(selectionFilePath(canvasDir), selection)
}

export async function loadViewState(canvasDir) {
  try {
    return await readJsonFile(viewStateFilePath(canvasDir))
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        version: 1,
        currentPageId: null,
        camera: { x: 0, y: 0, z: 1 },
        updatedAt: null,
      }
    }
    throw error
  }
}

export async function saveViewState(canvasDir, viewState) {
  await writeJsonAtomic(viewStateFilePath(canvasDir), viewState)
}

export function resolveAssetPath(canvasDir, fileName) {
  return join(assetsDirPath(canvasDir), fileName)
}

export async function saveAsset(canvasDir, sourcePath, fileName) {
  const destPath = resolveAssetPath(canvasDir, fileName)
  await mkdir(assetsDirPath(canvasDir), { recursive: true })
  await copyFile(sourcePath, destPath)
  return relative(canvasDir, destPath)
}

export async function listAssets(canvasDir) {
  try {
    const entries = await readdir(assetsDirPath(canvasDir), { withFileTypes: true })
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}
