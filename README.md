# AgentCanvas

A local, agent-controlled infinite canvas for AI coding assistants. Built with [tldraw](https://tldraw.dev/), AgentCanvas gives Kimi Code, Claude Code, OpenCode and Codex a shared visual whiteboard alongside your codebase.

## Features

- **Browser-based canvas** — tldraw-powered infinite canvas.
- **MCP server** — agents add text, images and shapes via standard MCP tools.
- **Project-local storage** — each project gets its own `canvas/` directory.
- **Live sync** — changes sync across browser tabs via Server-Sent Events.
- **Multi-agent support** — skill instructions for Kimi Code, Claude Code and Codex.

## Quick start

```bash
git clone git@github.com:tomsen-ai/agent-canvas.git
cd agent-canvas/web
npm install
npm run build
cd ..
node server/index.mjs
```

Open http://127.0.0.1:43217 in your browser.

## MCP setup

Add the MCP server to your agent:

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

## Tools

| Tool | Description |
|------|-------------|
| `canvas_open` | Start the canvas server for a project. |
| `canvas_add_text` | Add a text shape. |
| `canvas_add_image` | Copy a local image into the canvas. |
| `canvas_get_state` | List shapes on the current page. |
| `canvas_clear` | Remove all shapes from the current page. |

## Environment variables

- `AGENTCANVAS_PROJECT_DIR` — Project directory (default: current working directory).
- `AGENTCANVAS_PORT` — Server port (default: `43217`).
- `AGENTCANVAS_CANVAS_DIR` — Canvas storage sub-directory (default: `canvas`).

## License

MIT
