# AI Token Saver

AI Token Saver 是一个 VS Code 插件，用来帮助开发者在使用 ChatGPT、Claude Code、Codex、Copilot、Cursor、Cline 等 AI 编程工具前，减少无效上下文和 token 浪费。

插件不调用任何 AI API，只做本地分析：估算 token、生成 `.aiignore`、整理最小上下文包、生成 Bug 修复 Prompt，并把常用内容一键复制为 AI 友好的代码块。

## 功能

- 估算当前文件 token 数量
- 估算选中代码 token 数量
- 状态栏实时显示当前文件 token 预估
- 右键菜单快速估算、复制、生成上下文
- 一键生成 `.aiignore`
- 一键生成 AI 最小上下文包
- 一键生成 Bug 修复 Prompt
- 一键复制当前文件为 AI 上下文
- 一键复制当前文件或选区为 Markdown 代码块
- Output Channel 持久记录 token 报告，避免提示一闪而过

## 配置项

可以在 VS Code Settings 中搜索 `AI Token Saver`，或在 `settings.json` 中配置：

```json
{
  "aiTokenSaver.maxFiles": 120,
  "aiTokenSaver.contextBudget": 20000,
  "aiTokenSaver.maxSelectedFiles": 20,
  "aiTokenSaver.includePattern": "**/*.{ts,tsx,js,jsx,vue,py,go,java,cs,cpp,c,h,hpp,md,json,yaml,yml,sql,html,css,scss,less}",
  "aiTokenSaver.excludeGlobs": [
    "**/fixtures/**",
    "**/*.snap"
  ],
  "aiTokenSaver.maxFileBytes": 1000000,
  "aiTokenSaver.statusBarMaxFileBytes": 300000,
  "aiTokenSaver.fileReadTimeoutMs": 1500,
  "aiTokenSaver.scanConcurrency": 6
}
```

说明：

- `maxFiles`：构建上下文包时最多扫描多少个文件
- `contextBudget`：推荐上下文的 token 预算
- `maxSelectedFiles`：上下文包最多推荐多少个文件
- `includePattern`：扫描文件的 include glob
- `excludeGlobs`：额外排除规则，可写 glob 或 `.aiignore` 风格规则
- `maxFileBytes`：单文件读取大小上限，过大的文件会跳过
- `statusBarMaxFileBytes`：状态栏自动估算的文件大小上限，避免大文件编辑时卡顿
- `fileReadTimeoutMs`：单个文件读取/状态检查超时时间，超时会跳过
- `scanConcurrency`：构建上下文包时的并发读取数量

## 使用方式

在 VS Code 中按：

```text
Ctrl + Shift + P
```

搜索：

```text
AI Token Saver
```

你会看到：

```text
AI Token Saver: Estimate Current File Tokens
AI Token Saver: Estimate Selection Tokens
AI Token Saver: Generate .aiignore
AI Token Saver: Build Minimal Context Pack
AI Token Saver: Create Bugfix Prompt
AI Token Saver: Copy Current File as AI Context
AI Token Saver: Copy as Code Block
```

也可以在编辑器右键菜单中直接使用估算、复制代码块、复制当前文件上下文、生成最小上下文包等命令。在资源管理器中右键某个文件或目录执行上下文包命令时，插件会优先扫描该文件或目录，而不是整个工作区。

生成 `.aiignore` 时，如果文件已经存在，插件会询问是追加缺失规则、覆盖，还是取消，避免误删已有规则。

## 开发运行

```bash
npm install
npm run compile
```

然后在 VS Code 中按 `F5`，会打开一个新的 Extension Development Host 窗口，在新窗口中测试插件命令。

## 打包 VSIX

```bash
npm install -g @vscode/vsce
vsce package
```

生成 `.vsix` 后，可以在 VS Code 中通过：

```text
Extensions -> ... -> Install from VSIX...
```

进行本地安装。
