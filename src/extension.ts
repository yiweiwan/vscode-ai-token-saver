import * as vscode from "vscode";
import { generateAiIgnoreFile } from "./aiIgnore";
import { getConfig } from "./config";
import { buildContextPack } from "./contextBuilder";
import { withTimeout } from "./fileOps";
import { buildCodeBlock, buildCurrentFileContext, createBugfixPrompt } from "./promptBuilder";
import { estimateTokens, formatBytes, formatNumber, getTokenLevel } from "./tokenEstimator";

function getActiveEditorOrWarn(): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("请先打开一个文件");
    return undefined;
  }
  return editor;
}

function isCancellationError(error: unknown): boolean {
  return error instanceof vscode.CancellationError || error instanceof Error && error.name === "Canceled";
}

async function openMarkdownDocument(content: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({
    content,
    language: "markdown"
  });
  await vscode.window.showTextDocument(doc, { preview: false });
}

function showTokenMessage(
  output: vscode.OutputChannel,
  message: string,
  details?: string[]
): Thenable<string | undefined> {
  const timestamp = new Date().toLocaleString();
  output.appendLine(`[${timestamp}] ${message}`);
  for (const detail of details || []) {
    output.appendLine(`  ${detail}`);
  }
  output.appendLine("");

  return vscode.window.showInformationMessage(message, "查看 token 报告").then((choice) => {
    if (choice === "查看 token 报告") {
      output.show(true);
    }
    return choice;
  });
}

function getSelectionOrDocumentText(editor: vscode.TextEditor): { text: string; label: string; relativePath: string } {
  const relPath = vscode.workspace.asRelativePath(editor.document.uri);
  if (!editor.selection.isEmpty) {
    const startLine = editor.selection.start.line + 1;
    const endLine = editor.selection.end.line + 1;
    return {
      text: editor.document.getText(editor.selection),
      label: `选中代码片段（${relPath}:${startLine}-${endLine}）`,
      relativePath: `${relPath}:${startLine}`
    };
  }

  return {
    text: editor.document.getText(),
    label: `当前文件（${relPath}）`,
    relativePath: relPath
  };
}

function pickCommandUri(resourceUri?: vscode.Uri, selectedUris?: vscode.Uri[]): vscode.Uri | undefined {
  if (resourceUri) return resourceUri;
  if (selectedUris && selectedUris.length > 0) return selectedUris[0];
  return undefined;
}

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel("AI Token Saver");
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  let statusVersion = 0;

  statusBar.command = "aiTokenSaver.estimateCurrentFile";
  statusBar.text = "$(symbol-number) TokenSaver";
  statusBar.tooltip = "估算当前文件 token";
  statusBar.show();

  const updateStatusBar = () => {
    if (statusTimer) clearTimeout(statusTimer);
    const version = ++statusVersion;

    statusTimer = setTimeout(async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        statusBar.text = "$(symbol-number) TokenSaver";
        statusBar.tooltip = "打开文件后显示当前 token 预估";
        return;
      }

      const config = getConfig();
      const doc = editor.document;
      const file = vscode.workspace.asRelativePath(doc.uri);

      if (!doc.isUntitled && doc.uri.scheme !== "untitled") {
        try {
          const stat = await withTimeout(vscode.workspace.fs.stat(doc.uri), 500, "读取当前文件大小");
          if (version !== statusVersion) return;

          if (stat.size > config.statusBarMaxFileBytes) {
            statusBar.text = "$(symbol-number) TokenSaver: 大文件";
            statusBar.tooltip = new vscode.MarkdownString(
              `**AI Token Saver**\n\n${file}\n\n文件大小：${formatBytes(stat.size)}\n\n已超过状态栏实时估算上限 ${formatBytes(config.statusBarMaxFileBytes)}，点击可手动估算。`
            );
            return;
          }
        } catch {
          statusBar.text = "$(symbol-number) TokenSaver";
          statusBar.tooltip = "暂时无法读取当前文件大小，点击可手动估算";
          return;
        }
      }

      const tokens = estimateTokens(doc.getText());
      if (version !== statusVersion) return;

      const level = getTokenLevel(tokens);
      statusBar.text = `$(symbol-number) ${formatNumber(tokens)} tokens`;
      statusBar.tooltip = new vscode.MarkdownString(
        `**AI Token Saver**\n\n${file}\n\n预估：${formatNumber(tokens)} tokens\n\n消耗等级：${level}\n\n点击查看详细报告`
      );
    }, 250);
  };

  const estimateCurrentFileCommand = vscode.commands.registerCommand(
    "aiTokenSaver.estimateCurrentFile",
    async () => {
      const editor = getActiveEditorOrWarn();
      if (!editor) return;

      const text = editor.document.getText();
      const tokens = estimateTokens(text);
      const level = getTokenLevel(tokens);
      const file = vscode.workspace.asRelativePath(editor.document.uri);

      await showTokenMessage(
        output,
        `${file}：约 ${formatNumber(tokens)} tokens，消耗等级：${level}`,
        [
          `字符数：${formatNumber(text.length)}`,
          "说明：这是本地粗略估算，用于判断粘贴上下文前的量级，不等同于模型账单 token。"
        ]
      );
      updateStatusBar();
    }
  );

  const estimateSelectionCommand = vscode.commands.registerCommand(
    "aiTokenSaver.estimateSelection",
    async () => {
      const editor = getActiveEditorOrWarn();
      if (!editor) return;

      const text = editor.document.getText(editor.selection);
      if (!text.trim()) {
        vscode.window.showWarningMessage("请先选中一段代码或文本");
        return;
      }

      const tokens = estimateTokens(text);
      const level = getTokenLevel(tokens);
      await showTokenMessage(
        output,
        `选中内容约 ${formatNumber(tokens)} tokens，消耗等级：${level}`,
        [`字符数：${formatNumber(text.length)}`]
      );
    }
  );

  const generateAiIgnoreCommand = vscode.commands.registerCommand(
    "aiTokenSaver.generateAiIgnore",
    async () => {
      try {
        const result = await generateAiIgnoreFile();
        const doc = await vscode.workspace.openTextDocument(result.uri);
        await vscode.window.showTextDocument(doc, { preview: false });

        const messages = {
          created: ".aiignore 已生成，可继续按项目补充规则",
          appended: `.aiignore 已追加 ${result.missingRuleCount} 条缺失规则`,
          overwritten: ".aiignore 已覆盖为推荐规则",
          unchanged: ".aiignore 已存在，且无需补充推荐规则"
        };
        await showTokenMessage(output, messages[result.action]);
      } catch (error: unknown) {
        if (isCancellationError(error)) return;
        const message = error instanceof Error ? error.message : "生成 .aiignore 失败";
        vscode.window.showErrorMessage(message);
        output.appendLine(`[${new Date().toLocaleString()}] ${message}`);
      }
    }
  );

  const buildContextPackCommand = vscode.commands.registerCommand(
    "aiTokenSaver.buildContextPack",
    async (resourceUri?: vscode.Uri, selectedUris?: vscode.Uri[]) => {
      try {
        const taskDescription = await vscode.window.showInputBox({
          prompt: "请输入你准备问 AI 的任务，例如：修复新增监听配置 422 报错",
          placeHolder: "修复 Bug / 新增功能 / 重构模块 / 解释代码",
          ignoreFocusOut: true
        });
        if (taskDescription === undefined) return;

        const rootUri = pickCommandUri(resourceUri, selectedUris);
        const markdown = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "AI Token Saver 正在扫描工作区",
            cancellable: true
          },
          async (_progress, token) => buildContextPack(taskDescription, { rootUri, cancellationToken: token })
        );
        const tokens = estimateTokens(markdown);

        await openMarkdownDocument(markdown);
        await vscode.env.clipboard.writeText(markdown);
        await showTokenMessage(
          output,
          `AI 最小上下文包已生成并复制，报告约 ${formatNumber(tokens)} tokens`,
          ["详情已写入新 Markdown 文档。"]
        );
      } catch (error: unknown) {
        if (isCancellationError(error)) {
          output.appendLine(`[${new Date().toLocaleString()}] 已取消生成上下文包`);
          return;
        }
        const message = error instanceof Error ? error.message : "生成上下文包失败";
        vscode.window.showErrorMessage(message);
        output.appendLine(`[${new Date().toLocaleString()}] ${message}`);
      }
    }
  );

  const createBugfixPromptCommand = vscode.commands.registerCommand(
    "aiTokenSaver.createBugfixPrompt",
    async () => {
      try {
        const editor = vscode.window.activeTextEditor;
        const relatedFile = editor ? vscode.workspace.asRelativePath(editor.document.uri) : "";

        const errorLog = await vscode.window.showInputBox({
          prompt: "请粘贴一小段关键报错日志，也可以先留空",
          placeHolder: "例如：POST /api/watch-config 422 Unprocessable Entity",
          ignoreFocusOut: true
        });
        if (errorLog === undefined) return;

        const prompt = createBugfixPrompt(errorLog, relatedFile ? [relatedFile] : []);
        const tokens = estimateTokens(prompt);
        await openMarkdownDocument(prompt);
        await vscode.env.clipboard.writeText(prompt);
        await showTokenMessage(output, `Bug 修复 Prompt 已生成并复制，约 ${formatNumber(tokens)} tokens`);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "生成 Bug 修复 Prompt 失败";
        vscode.window.showErrorMessage(message);
        output.appendLine(`[${new Date().toLocaleString()}] ${message}`);
      }
    }
  );

  const copyCurrentFileContextCommand = vscode.commands.registerCommand(
    "aiTokenSaver.copyCurrentFileContext",
    async () => {
      try {
        const content = await buildCurrentFileContext();
        const tokens = estimateTokens(content);
        await vscode.env.clipboard.writeText(content);
        await showTokenMessage(output, `当前文件上下文已复制，约 ${formatNumber(tokens)} tokens`);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "复制当前文件上下文失败";
        vscode.window.showErrorMessage(message);
        output.appendLine(`[${new Date().toLocaleString()}] ${message}`);
      }
    }
  );

  const copyAsCodeBlockCommand = vscode.commands.registerCommand(
    "aiTokenSaver.copyAsCodeBlock",
    async () => {
      try {
        const editor = getActiveEditorOrWarn();
        if (!editor) return;

        const source = getSelectionOrDocumentText(editor);
        if (!source.text.trim()) {
          vscode.window.showWarningMessage("没有可复制的代码内容");
          return;
        }

        const content = buildCodeBlock(source.relativePath, editor.document.languageId, source.text, source.label);
        const tokens = estimateTokens(content);
        await vscode.env.clipboard.writeText(content);
        await showTokenMessage(output, `${source.label}已复制为代码块，约 ${formatNumber(tokens)} tokens`);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "复制为代码块失败";
        vscode.window.showErrorMessage(message);
        output.appendLine(`[${new Date().toLocaleString()}] ${message}`);
      }
    }
  );

  context.subscriptions.push(
    output,
    statusBar,
    estimateCurrentFileCommand,
    estimateSelectionCommand,
    generateAiIgnoreCommand,
    buildContextPackCommand,
    createBugfixPromptCommand,
    copyCurrentFileContextCommand,
    copyAsCodeBlockCommand,
    vscode.window.onDidChangeActiveTextEditor(updateStatusBar),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (vscode.window.activeTextEditor?.document === event.document) {
        updateStatusBar();
      }
    })
  );

  updateStatusBar();
}

export function deactivate() {}
