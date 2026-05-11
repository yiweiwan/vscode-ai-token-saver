import * as vscode from "vscode";

export async function withTimeout<T>(promise: Thenable<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 超时（${timeoutMs}ms）`)), timeoutMs);
  });

  try {
    return await Promise.race([Promise.resolve(promise), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function safeReadTextFile(
  uri: vscode.Uri,
  timeoutMs: number,
  maxBytes: number
): Promise<{ content: string; bytes: number } | undefined> {
  const stat = await withTimeout(vscode.workspace.fs.stat(uri), timeoutMs, "读取文件信息");
  if (stat.size > maxBytes) return undefined;

  const bytes = await withTimeout(vscode.workspace.fs.readFile(uri), timeoutMs, "读取文件");
  return {
    content: Buffer.from(bytes).toString("utf8"),
    bytes: bytes.byteLength
  };
}
