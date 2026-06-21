import { useEffect, useRef, useState } from 'react'
import { Tldraw, useEditor, getSnapshot } from 'tldraw'
import { loadCanvas, saveCanvas, saveSelection, saveViewState, subscribeToCanvasEvents } from './canvas-api'

function fitCameraWithMinZoom(editor, minZoom = 0.5) {
  const ids = [...editor.getCurrentPageShapeIds()].filter((id) => !editor.isShapeHidden(id))
  if (ids.length === 0) return

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const id of ids) {
    const b = editor.getShapePageBounds(id)
    if (!b) continue
    minX = Math.min(minX, b.x)
    minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.w)
    maxY = Math.max(maxY, b.y + b.h)
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return

  const bounds = { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
  if (bounds.w <= 0 || bounds.h <= 0) return

  const viewport = editor.getViewportScreenBounds()
  const inset = Math.min(editor.options.zoomToFitPadding, viewport.width * 0.28)
  const fitZoom = Math.min(
    (viewport.width - inset) / bounds.w,
    (viewport.height - inset) / bounds.h,
  )
  const zoom = Math.max(fitZoom, minZoom)

  editor.setCamera({
    x: -bounds.x + (viewport.width - bounds.w * zoom) / 2 / zoom,
    y: -bounds.y + (viewport.height - bounds.h * zoom) / 2 / zoom,
    z: zoom,
  })
}

function CanvasSync() {
  const editor = useEditor()
  const initialized = useRef(false)
  const ignoreNextSave = useRef(false)

  useEffect(() => {
    if (!editor) return
    if (typeof window !== 'undefined') {
      window.agentCanvasEditor = editor
    }
    if (initialized.current) return
    initialized.current = true

    async function init() {
      try {
        const snapshot = await loadCanvas()
        if (snapshot) {
          ignoreNextSave.current = true
          editor.loadSnapshot(snapshot)
          fitCameraWithMinZoom(editor, 0.5)
        }
      } catch (error) {
        console.error('Failed to initialize canvas:', error)
      }
    }

    init()

    const unsubscribeStore = editor.store.listen(
      (event) => {
        if (event.changes.updated?.__meta__) return
        if (ignoreNextSave.current) {
          ignoreNextSave.current = false
          return
        }
        const snapshot = getSnapshot(editor.store)
        saveCanvas(snapshot)
      },
      { source: 'user', scope: 'document' },
    )

    const unsubscribeSelection = editor.sideEffects.registerAfterChangeHandler(
      'instance_page_state',
      () => {
        const selectedIds = editor.getSelectedShapeIds()
        saveSelection({
          selectedShapes: selectedIds,
          updatedAt: new Date().toISOString(),
        })
      },
    )

    const unsubscribeCamera = editor.sideEffects.registerAfterChangeHandler(
      'camera',
      () => {
        const camera = editor.getCamera()
        const currentPageId = editor.getCurrentPageId()
        saveViewState({
          version: 1,
          currentPageId,
          camera: { x: camera.x, y: camera.y, z: camera.z },
          updatedAt: new Date().toISOString(),
        })
      },
    )

    const unsubscribeEvents = subscribeToCanvasEvents((payload) => {
      if (payload.snapshot) {
        ignoreNextSave.current = true
        editor.loadSnapshot(payload.snapshot)
      }
    })

    return () => {
      unsubscribeStore()
      unsubscribeSelection()
      unsubscribeCamera()
      unsubscribeEvents()
    }
  }, [editor])

  return null
}

export default function App() {
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    setIsReady(true)
  }, [])

  if (!isReady) return null

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Tldraw>
        <CanvasSync />
      </Tldraw>
    </div>
  )
}
