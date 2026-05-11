import * as vscode from "vscode";
import { getConfig } from "./config";
import { withTimeout } from "./fileOps";

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

export async function generateAiIgnoreFile(): Promise<vscode.Uri> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    throw new Error("请先打开一个工作区，再生成 .aiignore");
  }

  const config = getConfig();
  const configuredRules = config.excludeGlobs.length > 0
    ? `\n# Rules from aiTokenSaver.excludeGlobs\n${config.excludeGlobs.join("\n")}\n`
    : "";

  const target = vscode.Uri.joinPath(folders[0].uri, ".aiignore");
  await withTimeout(
    vscode.workspace.fs.writeFile(target, Buffer.from(DEFAULT_AIIGNORE + configuredRules, "utf8")),
    config.fileReadTimeoutMs,
    "写入 .aiignore"
  );
  return target;
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
