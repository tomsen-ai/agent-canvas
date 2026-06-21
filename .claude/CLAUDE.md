# AgentCanvas proactive usage

You have access to the `agentcanvas` MCP server. Use it to make this conversation visual and interactive.

## When to call automatically

Do not wait for the user to ask for the canvas explicitly. Use the AgentCanvas tools proactively when the conversation matches any of these situations:

- **Project overview** — The user asks "how is this project organized?", "explain the codebase", or "what does this repo look like?"  
  → Call `canvas_visualize_project`.
- **File exploration** — The user asks about a specific file's contents, functions, classes, or types.  
  → Call `canvas_visualize_file` with the file path.
- **Dependency/coupling questions** — The user asks "what imports this?", "what are the dependencies?", "show the module graph", or "how are these files related?"  
  → Call `canvas_visualize_dependencies`.
- **Notes or labels** — The user wants to summarize, compare, or mark something on the canvas.  
  → Call `canvas_add_text`.
- **Images or screenshots** — The user mentions a local image, diagram, or screenshot they want on the canvas.  
  → Call `canvas_add_image`.

## Before any canvas action

If the server may not be running, call `canvas_open` first. It returns the browser URL that the user can open to view or edit the canvas.

## After visualizing

1. Tell the user the canvas URL.
2. Briefly summarize what was drawn (e.g., number of files, key clusters, notable dependencies).
3. Offer next steps, such as zooming to a specific area or adding a note.
