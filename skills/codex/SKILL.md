# AgentCanvas for Codex

AgentCanvas is a local, agent-controlled infinite canvas built on tldraw.

## Setup

1. Clone and build:

   ```bash
   git clone git@github.com:tomsen-ai/agent-canvas.git
   cd agent-canvas/web
   npm install
   npm run build
   ```

2. Add an MCP server entry to your Codex configuration (`~/.codex/config.json` or project `codex.md`):

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

3. Restart Codex.

## Tools

- `canvas_open`
- `canvas_add_text`
- `canvas_add_image`
- `canvas_get_state`
- `canvas_clear`

## Tip

Call `canvas_open` first so the server records the project directory for subsequent tool calls.
