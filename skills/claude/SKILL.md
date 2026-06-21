# AgentCanvas for Claude

让 Claude 拥有一个本地无限画布，可在对话中直接添加文本、图片和图形。

## 支持的产品

- **Claude Code**（命令行 `claude`）
- **Claude Desktop**（macOS / Windows 桌面应用）

两者都通过 MCP（Model Context Protocol）接入。

## 前置准备

1. 克隆仓库并构建前端：

   ```bash
   git clone git@github.com:tomsen-ai/agent-canvas.git
   cd agent-canvas/web
   npm install
   npm run build
   cd ..
   ```

2. 记下 `mcp/server.mjs` 的**绝对路径**，例如：

   ```
   /Users/YOUR_NAME/agent-canvas/mcp/server.mjs
   ```

## Claude Code 配置

Claude Code 的 MCP 服务器配置在 `~/.claude.json`。编辑该文件，在 `mcpServers` 下加入：

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

保存后重启 Claude Code。

## Claude Desktop 配置

编辑对应操作系统的配置文件：

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

加入：

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

保存后完全退出并重新打开 Claude Desktop。你可以在设置里看到 `agentcanvas` 工具是否加载成功。

## 让 Claude 主动调用（推荐）

把本仓库里的 `.claude/CLAUDE.md` 复制到你的项目根目录（或 `~/.claude/CLAUDE.md`），Claude 就会在这些场景下**自动**使用画布：

- 询问项目结构 / 代码组织 → 自动 `canvas_visualize_project`
- 询问某个文件里的函数、类、类型 → 自动 `canvas_visualize_file`
- 询问依赖关系 / 模块图 / 谁引用了谁 → 自动 `canvas_visualize_dependencies`
- 想记笔记、加标签、总结 → 自动 `canvas_add_text`
- 提到本地截图 / 图片 / 流程图 → 自动 `canvas_add_image`

## 可用工具

| 工具 | 作用 |
|------|------|
| `canvas_open` | 为当前项目启动画布服务器，返回访问链接 |
| `canvas_add_text` | 添加文本便签 |
| `canvas_add_image` | 把本地图片复制到画布 |
| `canvas_get_state` | 查看当前页有哪些图形 |
| `canvas_clear` | 清空当前页 |
| `canvas_visualize_project` | 把项目目录结构可视化到画布 |
| `canvas_visualize_file` | 把单个代码文件的函数/类/类型可视化到画布 |
| `canvas_visualize_dependencies` | 把 JS/TS 文件间的 import 依赖关系可视化到画布 |

## 典型用法

直接对 Claude 说：

- “打开当前项目的画布”
- “在画布上添加一个文本：项目架构 overview，放在 (100, 100)”
- “把 `/Users/YOUR_NAME/Downloads/diagram.png` 添加到画布”
- “可视化这个项目的目录结构”
- “分析 `server/api-routes.mjs` 这个文件”
- “画一下这个项目的模块依赖图”
- “清空画布”

Claude 会自动调用对应工具。画布链接出现后，你可以在浏览器里打开并手动编辑。

## 注意事项

- 如果 Claude 找不到工具，检查 `node` 是否在系统 PATH 中。
- `args` 里一定要使用 `mcp/server.mjs` 的**绝对路径**。
- 每个项目的画布数据存在 `<projectDir>/canvas/agentcanvas-canvas.json`。
