import * as vscode from "vscode";

export interface AiTokenSaverConfig {
  maxFiles: number;
  contextBudget: number;
  maxSelectedFiles: number;
  maxFileBytes: number;
  fileReadTimeoutMs: number;
  includePattern: string;
  excludeGlobs: string[];
}

const DEFAULT_INCLUDE_PATTERN = "**/*.{ts,tsx,js,jsx,vue,py,go,java,cs,cpp,c,h,hpp,md,json,yaml,yml,sql,html,css,scss,less}";

export const DEFAULT_EXCLUDE_GLOBS = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/.venv/**",
  "**/venv/**",
  "**/__pycache__/**",
  "**/runs/**",
  "**/datasets/**",
  "**/weights/**",
  "**/*.pt",
  "**/*.pth",
  "**/*.onnx",
  "**/*.engine",
  "**/*.jpg",
  "**/*.jpeg",
  "**/*.png",
  "**/*.mp4",
  "**/*.avi",
  "**/*.mov",
  "**/*.zip",
  "**/*.rar",
  "**/*.7z",
  "**/*.log"
];

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), min), max);
}

export function getConfig(): AiTokenSaverConfig {
  const config = vscode.workspace.getConfiguration("aiTokenSaver");

  return {
    maxFiles: clampNumber(config.get<number>("maxFiles", 120), 1, 5000, 120),
    contextBudget: clampNumber(config.get<number>("contextBudget", 20_000), 1000, 500_000, 20_000),
    maxSelectedFiles: clampNumber(config.get<number>("maxSelectedFiles", 20), 1, 100, 20),
    maxFileBytes: clampNumber(config.get<number>("maxFileBytes", 1_000_000), 1024, 50_000_000, 1_000_000),
    fileReadTimeoutMs: clampNumber(config.get<number>("fileReadTimeoutMs", 1500), 100, 30_000, 1500),
    includePattern: config.get<string>("includePattern", DEFAULT_INCLUDE_PATTERN) || DEFAULT_INCLUDE_PATTERN,
    excludeGlobs: config.get<string[]>("excludeGlobs", [])
      .map((item) => item.trim())
      .filter(Boolean)
  };
}
