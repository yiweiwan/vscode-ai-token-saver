import * as vscode from "vscode";

export function createBugfixPrompt(errorLog: string, relatedFiles: string[]): string {
  const fileList = relatedFiles.length > 0
    ? relatedFiles.map((file) => `- ${file}`).join("\n")
    : "- 请补充相关文件路径";

  return `# Bug 修复请求

请帮我修复下面这个 Bug。请优先基于最小上下文判断，不要要求我一次性提供整个项目。

## 问题现象

请在这里补充：点击了什么、出现了什么结果、期望应该是什么。

## 复现步骤

1.
2.
3.

## 报错日志

\`\`\`text
${errorLog || "请粘贴关键报错日志，不要粘贴超长无关日志"}
\`\`\`

## 相关文件

${fileList}

## 请重点检查

1. 前端请求参数是否和后端接口 Schema 一致；
2. 后端路由是否存在必填字段缺失；
3. 数据库字段是否和模型定义一致；
4. 是否存在路径、权限、异步任务、队列状态问题；
5. 是否存在类型不一致、空值、未初始化配置等问题。

## 输出要求

1. 先说明最可能的问题原因；
2. 再给出排查步骤；
3. 最后给出修改代码或补丁；
4. 如果上下文不足，请明确指出还需要哪一个具体文件，不要要求我上传整个项目。`;
}

export async function buildCurrentFileContext(): Promise<string> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    throw new Error("请先打开一个文件");
  }

  const relPath = vscode.workspace.asRelativePath(editor.document.uri);
  const text = editor.document.getText();

  return buildCodeBlock(relPath, editor.document.languageId, text, "当前文件上下文");
}

export function buildCodeBlock(
  relativePath: string,
  languageId: string,
  text: string,
  title = "代码片段"
): string {
  const fence = text.includes("```") ? "````" : "```";

  return `# ${title}

文件路径：${relativePath}

${fence}${languageId}
${text}
${fence}
`;
}
