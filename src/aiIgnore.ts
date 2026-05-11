import * as vscode from "vscode";
import { getConfig } from "./config";
import { withTimeout } from "./fileOps";

export type GenerateAiIgnoreAction = "created" | "appended" | "overwritten" | "unchanged";

export interface GenerateAiIgnoreResult {
  uri: vscode.Uri;
  action: GenerateAiIgnoreAction;
  missingRuleCount: number;
}

export const DEFAULT_AIIGNORE = `# AI Token Saver ignore rules
# These files usually waste LLM tokens and should not be pasted into AI coding tools.

# Dependencies
node_modules/
.venv/
venv/
env/
__pycache__/

# Build outputs
dist/
build/
out/
target/
.next/
.nuxt/
coverage/

# Git and editor
.git/
.vscode/
.idea/

# Logs
*.log
logs/

# Environment and secrets
.env
.env.*
*.pem
*.key
*.crt

# Package lock files can be large; include them manually only when needed
package-lock.json
yarn.lock
pnpm-lock.yaml

# AI / CV / model outputs
*.pt
*.pth
*.onnx
*.engine
*.weights
*.safetensors
runs/
datasets/
weights/

# Media and binary files
*.jpg
*.jpeg
*.png
*.gif
*.bmp
*.webp
*.mp4
*.avi
*.mov
*.zip
*.rar
*.7z
*.exe
*.dll
`;

function getDesiredAiIgnoreContent(): string {
  const config = getConfig();
  const configuredRules = config.excludeGlobs.length > 0
    ? `\n# Rules from aiTokenSaver.excludeGlobs\n${config.excludeGlobs.join("\n")}\n`
    : "";

  return DEFAULT_AIIGNORE + configuredRules;
}

function extractRules(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

async function readExistingAiIgnore(
  uri: vscode.Uri,
  timeoutMs: number
): Promise<{ exists: boolean; content?: string }> {
  try {
    await withTimeout(vscode.workspace.fs.stat(uri), timeoutMs, "检查 .aiignore");
  } catch {
    return { exists: false };
  }

  try {
    const bytes = await withTimeout(vscode.workspace.fs.readFile(uri), timeoutMs, "读取 .aiignore");
    return { exists: true, content: Buffer.from(bytes).toString("utf8") };
  } catch {
    throw new Error(".aiignore 已存在，但无法读取。请检查文件权限或手动打开后再重试。");
  }
}

export async function generateAiIgnoreFile(): Promise<GenerateAiIgnoreResult> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    throw new Error("请先打开一个工作区，再生成 .aiignore");
  }

  const config = getConfig();
  const target = vscode.Uri.joinPath(folders[0].uri, ".aiignore");
  const desiredContent = getDesiredAiIgnoreContent();
  const existing = await readExistingAiIgnore(target, config.fileReadTimeoutMs);

  if (!existing.exists) {
    await withTimeout(
      vscode.workspace.fs.writeFile(target, Buffer.from(desiredContent, "utf8")),
      config.fileReadTimeoutMs,
      "写入 .aiignore"
    );
    return { uri: target, action: "created", missingRuleCount: extractRules(desiredContent).length };
  }

  const existingContent = existing.content || "";
  const existingRules = new Set(extractRules(existingContent));
  const missingRules = extractRules(desiredContent).filter((rule) => !existingRules.has(rule));

  if (missingRules.length === 0) {
    return { uri: target, action: "unchanged", missingRuleCount: 0 };
  }

  const choice = await vscode.window.showWarningMessage(
    ".aiignore 已存在，要如何处理 AI Token Saver 的推荐规则？",
    "追加缺失规则",
    "覆盖",
    "取消"
  );

  if (!choice || choice === "取消") {
    throw new vscode.CancellationError();
  }

  if (choice === "覆盖") {
    await withTimeout(
      vscode.workspace.fs.writeFile(target, Buffer.from(desiredContent, "utf8")),
      config.fileReadTimeoutMs,
      "覆盖 .aiignore"
    );
    return { uri: target, action: "overwritten", missingRuleCount: missingRules.length };
  }

  const appendedContent = `${existingContent.trimEnd()}\n\n# Added by AI Token Saver\n${missingRules.join("\n")}\n`;
  await withTimeout(
    vscode.workspace.fs.writeFile(target, Buffer.from(appendedContent, "utf8")),
    config.fileReadTimeoutMs,
    "追加 .aiignore"
  );
  return { uri: target, action: "appended", missingRuleCount: missingRules.length };
}

export async function readAiIgnorePatterns(timeoutMs = 1500): Promise<string[]> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return [];

  const file = vscode.Uri.joinPath(folders[0].uri, ".aiignore");

  try {
    const bytes = await withTimeout(vscode.workspace.fs.readFile(file), timeoutMs, "读取 .aiignore");
    const content = Buffer.from(bytes).toString("utf8");
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
  } catch {
    return [];
  }
}

export function aiIgnoreToGlob(pattern: string): string {
  const clean = pattern.replace(/^\/+/, "").trim();

  if (!clean) return "";

  if (clean.endsWith("/")) {
    return `**/${clean}**`;
  }

  if (clean.includes("*")) {
    return clean.startsWith("**/") ? clean : `**/${clean}`;
  }

  return `**/${clean}`;
}
