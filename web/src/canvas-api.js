const API_BASE = ''

let eventSource = null
let eventVersion = 0

function apiUrl(path) {
  return `${API_BASE}${path}`
}

export async function loadCanvas() {
  const res = await fetch(apiUrl('/api/canvas'))
  if (!res.ok) throw new Error(`Failed to load canvas: ${res.status}`)
  const data = await res.json()
  return data.snapshot ?? null
}

let saveTimeout = null

export function saveCanvas(snapshot) {
  if (saveTimeout) clearTimeout(saveTimeout)
  saveTimeout = setTimeout(async () => {
    try {
      const document = snapshot.document ?? snapshot
      const res = await fetch(apiUrl('/api/canvas'), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(document),
      })
      if (!res.ok) throw new Error(`Failed to save canvas: ${res.status}`)
    } catch (error) {
      console.error('Save canvas failed:', error)
    }
  }, 300)
}

export async function saveSelection(selection) {
  try {
    const res = await fetch(apiUrl('/api/selection'), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(selection),
    })
    if (!res.ok) throw new Error(`Failed to save selection: ${res.status}`)
  } catch (error) {
    console.error('Save selection failed:', error)
  }
}

export async function saveViewState(viewState) {
  try {
    const res = await fetch(apiUrl('/api/view-state'), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(viewState),
    })
    if (!res.ok) throw new Error(`Failed to save view state: ${res.status}`)
  } catch (error) {
    console.error('Save view state failed:', error)
  }
}

export function subscribeToCanvasEvents(onChange) {
  if (eventSource) eventSource.close()

  eventSource = new EventSource(apiUrl('/api/canvas-events'))

  eventSource.addEventListener('canvas-changed', (event) => {
    try {
      const payload = JSON.parse(event.data)
      if (payload.version > eventVersion) {
        eventVersion = payload.version
        onChange(payload)
      }
    } catch (error) {
      console.error('Failed to parse canvas event:', error)
    }
  })

  eventSource.addEventListener('error', (error) => {
    console.error('Canvas events SSE error:', error)
  })

  return () => {
    eventSource?.close()
    eventSource = null
  }
}
