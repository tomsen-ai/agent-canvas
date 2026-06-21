# AgentCanvas for Claude Code

AgentCanvas is a local, agent-controlled infinite canvas built on tldraw. It lets Claude Code create and edit a visual whiteboard alongside your code.

## Setup

1. Clone and build:

   ```bash
   git clone git@github.com:tomsen-ai/agent-canvas.git
   cd agent-canvas/web
   npm install
   npm run build
   ```

2. Register the MCP server. Add to `~/.claude/CLAUDE.md` or your Claude Code project settings:

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

3. Restart Claude Code.

## Tools

- `canvas_open`
- `canvas_add_text`
- `canvas_add_image`
- `canvas_get_state`
- `canvas_clear`

## Notes

- The server stores canvas data in `<projectDir>/canvas/`.
- Pass `projectDir` explicitly to each tool if the server was not started via `canvas_open`.
