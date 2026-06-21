import { useEffect, useRef, useState } from 'react'
import { Tldraw, useEditor, getSnapshot } from 'tldraw'
import { loadCanvas, saveCanvas, saveSelection, saveViewState, subscribeToCanvasEvents } from './canvas-api'

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
          editor.zoomToFit()
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
