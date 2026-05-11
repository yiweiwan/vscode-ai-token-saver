export type TokenLevel = "低" | "中" | "高" | "极高";

/**
 * Rough local token estimator.
 * It is not model-billing accurate, but good enough for warning users before they paste huge context.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  const cjkMatches = text.match(/[\u3400-\u9fff]/g);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;
  const nonCjkCount = Math.max(text.length - cjkCount, 0);

  // Practical rough estimate:
  // - Chinese/Japanese/Korean: about 1 token per 1.5 chars
  // - English/code: about 1 token per 4 chars
  const cjkTokens = cjkCount / 1.5;
  const nonCjkTokens = nonCjkCount / 4;

  return Math.ceil(cjkTokens + nonCjkTokens);
}

export function getTokenLevel(tokens: number): TokenLevel {
  if (tokens < 2_000) return "低";
  if (tokens < 8_000) return "中";
  if (tokens < 20_000) return "高";
  return "极高";
}

export function formatNumber(num: number): string {
  return new Intl.NumberFormat("zh-CN").format(num);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}
