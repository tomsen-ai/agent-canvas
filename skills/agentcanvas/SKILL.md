# AgentCanvas for Kimi Code

AgentCanvas is a local, agent-controlled infinite canvas built on tldraw. It lets Kimi Code create and edit a visual whiteboard alongside your code.

## What it does

- Opens a browser-based tldraw canvas for the current project.
- Adds text, images and shapes via MCP tools.
- Persists the canvas in `canvas/agentcanvas-canvas.json`.
- Syncs changes across browser tabs via Server-Sent Events.

## Installation

1. Clone the repo and build the web bundle:

   ```bash
   git clone git@github.com:tomsen-ai/agent-canvas.git
   cd agent-canvas/web
   npm install
   npm run build
   ```

2. Add the MCP server to Kimi Code. Edit `~/.kimi-code/mcp.json` (or the Kimi Code MCP settings) and add:

   ```json
   {
     "mcpServers": {
       "agentcanvas": {
         "command": "node",
         "args": ["/absolute/path/to/agent-canvas/mcp/server.mjs"]
       }
     }
   }
   ```

3. Restart Kimi Code.

## Available tools

- `canvas_open` — Start the local canvas server and open its URL.
- `canvas_add_text` — Add a text shape.
- `canvas_add_image` — Copy a local image into the canvas.
- `canvas_get_state` — Summarize shapes on the current page.
- `canvas_clear` — Remove all shapes from the current page.

## Typical workflow

1. Call `canvas_open` with the current project directory.
2. Use `canvas_add_text` to add notes, labels or summaries.
3. Use `canvas_add_image` to paste diagrams or screenshots.
4. Tell the user the canvas URL so they can view or edit it in a browser.

## Environment variables

- `AGENTCANVAS_PROJECT_DIR` — Default project directory.
- `AGENTCANVAS_PORT` — Server port (default `43217`).
- `AGENTCANVAS_CANVAS_DIR` — Canvas storage sub-directory (default `canvas`).
