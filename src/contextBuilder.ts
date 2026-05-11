import * as vscode from "vscode";
import * as path from "path";
import { aiIgnoreToGlob, readAiIgnorePatterns } from "./aiIgnore";
import { DEFAULT_EXCLUDE_GLOBS, getConfig } from "./config";
import { safeReadTextFile } from "./fileOps";
import { estimateTokens, formatBytes, formatNumber } from "./tokenEstimator";

interface FileScore {
  uri: vscode.Uri;
  relativePath: string;
  tokens: number;
  bytes: number;
  score: number;
  reason: string;
}

interface ScanStats {
  skippedLarge: number;
  skippedUnreadable: number;
}

function splitTaskTerms(task: string): string[] {
  return task
    .toLowerCase()
    .split(/[\s,，。；;:：/\\_\-.()（）[\]{}<>"'`]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .slice(0, 20);
}

function scoreFile(relativePath: string, content: string, task: string, activeFile?: string): { score: number; reason: string } {
  const lowerPath = relativePath.toLowerCase();
  const lowerContent = content.toLowerCase();
  const terms = splitTaskTerms(task);

  let score = 0;
  const reasons: string[] = [];

  if (activeFile && relativePath === activeFile) {
    score += 100;
    reasons.push("当前打开文件");
  }

  for (const term of terms) {
    if (lowerPath.includes(term)) {
      score += 12;
      reasons.push(`路径匹配：${term}`);
    } else if (lowerContent.includes(term)) {
      score += 3;
    }
  }

  const ext = path.extname(relativePath).toLowerCase();
  if ([".ts", ".tsx", ".js", ".jsx", ".vue", ".py", ".go", ".java"].includes(ext)) {
    score += 5;
  }

  if (/(api|route|router|service|controller|schema|model|store|page|view|component|utils?)/i.test(relativePath)) {
    score += 8;
    reasons.push("常见关键代码文件");
  }

  if (/(package\.json|requirements\.txt|pyproject\.toml|vite\.config|tsconfig|data\.yaml|config)/i.test(relativePath)) {
    score += 4;
    reasons.push("配置/依赖文件");
  }

  if (reasons.length === 0) {
    reasons.push("代码文件");
  }

  return { score, reason: Array.from(new Set(reasons)).slice(0, 3).join("；") };
}

function buildExcludeGlob(extraPatterns: string[]): string {
  const globs = [...DEFAULT_EXCLUDE_GLOBS, ...extraPatterns.map(aiIgnoreToGlob)]
    .map((glob) => glob.trim())
    .filter(Boolean);
  return `{${Array.from(new Set(globs)).join(",")}}`;
}

export async function buildContextPack(taskDescription: string): Promise<string> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    throw new Error("请先打开一个工作区");
  }

  const config = getConfig();
  const aiIgnorePatterns = await readAiIgnorePatterns(config.fileReadTimeoutMs);
  const configuredExcludes = config.excludeGlobs;
  const excludeGlob = buildExcludeGlob([...aiIgnorePatterns, ...configuredExcludes]);

  const files = await vscode.workspace.findFiles(config.includePattern, excludeGlob, config.maxFiles);
  const activeFile = vscode.window.activeTextEditor
    ? vscode.workspace.asRelativePath(vscode.window.activeTextEditor.document.uri)
    : undefined;

  const scored: FileScore[] = [];
  const stats: ScanStats = {
    skippedLarge: 0,
    skippedUnreadable: 0
  };

  for (const uri of files) {
    const relativePath = vscode.workspace.asRelativePath(uri);

    try {
      const file = await safeReadTextFile(uri, config.fileReadTimeoutMs, config.maxFileBytes);
      if (!file) {
        stats.skippedLarge += 1;
        continue;
      }

      const tokens = estimateTokens(file.content);
      const { score, reason } = scoreFile(relativePath, file.content.slice(0, 80_000), taskDescription, activeFile);

      scored.push({
        uri,
        relativePath,
        tokens,
        bytes: file.bytes,
        score,
        reason
      });
    } catch {
      stats.skippedUnreadable += 1;
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.tokens - b.tokens;
  });

  const selected: FileScore[] = [];
  let usedTokens = 0;
  for (const item of scored) {
    if (selected.length >= config.maxSelectedFiles) break;
    if (item.tokens > 12_000) continue;
    if (usedTokens + item.tokens > config.contextBudget && selected.length >= 5) continue;
    selected.push(item);
    usedTokens += item.tokens;
  }

  const largeTokenFiles = scored.filter((item) => item.tokens > 12_000).slice(0, 10);
  const totalTokens = scored.reduce((sum, item) => sum + item.tokens, 0);

  const lines: string[] = [];
  lines.push("# AI 最小上下文包");
  lines.push("");
  lines.push(`生成时间：${new Date().toLocaleString()}`);
  lines.push(`工作区：${folders[0].name}`);
  lines.push(`任务描述：${taskDescription || "未填写，请补充"}`);
  lines.push("");
  lines.push("## 扫描概览");
  lines.push("");
  lines.push(`- 扫描文件数：${formatNumber(scored.length)} / 上限 ${formatNumber(config.maxFiles)}`);
  lines.push(`- 预估总代码 token：${formatNumber(totalTokens)}`);
  lines.push(`- 推荐上下文 token：${formatNumber(usedTokens)} / ${formatNumber(config.contextBudget)}`);
  lines.push(`- 推荐文件数：${formatNumber(selected.length)} / 上限 ${formatNumber(config.maxSelectedFiles)}`);
  lines.push(`- 已应用 .aiignore 规则数：${aiIgnorePatterns.length}`);
  lines.push(`- 已应用配置排除规则数：${configuredExcludes.length}`);
  lines.push(`- 跳过过大文件：${formatNumber(stats.skippedLarge)}（单文件上限 ${formatBytes(config.maxFileBytes)}）`);
  lines.push(`- 跳过不可读/超时文件：${formatNumber(stats.skippedUnreadable)}（超时 ${config.fileReadTimeoutMs}ms）`);
  lines.push("");
  lines.push("## 建议优先提供给 AI 的文件");
  lines.push("");
  lines.push("| 文件 | 预估 tokens | 大小 | 推荐原因 |");
  lines.push("|---|---:|---:|---|");
  for (const item of selected) {
    lines.push(`| \`${item.relativePath}\` | ${formatNumber(item.tokens)} | ${formatBytes(item.bytes)} | ${item.reason} |`);
  }

  if (largeTokenFiles.length > 0) {
    lines.push("");
    lines.push("## 大文件提醒");
    lines.push("");
    lines.push("以下文件 token 较高，不建议直接整文件发送，优先发送相关函数或片段：");
    lines.push("");
    for (const item of largeTokenFiles) {
      lines.push(`- \`${item.relativePath}\`：约 ${formatNumber(item.tokens)} tokens，${formatBytes(item.bytes)}`);
    }
  }

  lines.push("");
  lines.push("## 可直接复制给 AI 的提问模板");
  lines.push("");
  lines.push("```text");
  lines.push("请基于下面的最小上下文帮我处理问题，不要要求我上传整个项目。");
  lines.push("");
  lines.push("任务描述：");
  lines.push(taskDescription || "请补充你的具体问题");
  lines.push("");
  lines.push("请优先查看这些文件：");
  for (const item of selected.slice(0, 12)) {
    lines.push(`- ${item.relativePath}`);
  }
  lines.push("");
  lines.push("输出要求：");
  lines.push("1. 先判断最可能的问题原因；");
  lines.push("2. 再说明需要改哪些文件；");
  lines.push("3. 最后给出完整修改代码或补丁；");
  lines.push("4. 如果上下文不足，只指出还缺哪一个具体文件。");
  lines.push("```");

  lines.push("");
  lines.push("## 建议忽略的内容");
  lines.push("");
  lines.push("- `node_modules/`、`dist/`、`build/`、`.git/`");
  lines.push("- `runs/`、`datasets/`、`weights/`");
  lines.push("- `*.pt`、`*.onnx`、图片、视频、大型日志");

  return lines.join("\n");
}
