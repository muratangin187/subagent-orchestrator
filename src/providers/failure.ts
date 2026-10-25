import type { Provider, ProviderFailure } from "../types.js";

// Classify provider errors only, never assistant output. Preserve reset wording:
// relative times without dates cannot safely be converted to a timestamp.
export function classifyFailure(
  provider: Provider,
  error?: string,
): ProviderFailure | undefined {
  if (!error) return undefined;
  const usage =
    /usage_limit_reached|insufficient_quota|(?:hit|reached|exceeded).{0,40}(?:session|usage|weekly|monthly|spending|rate) limit|(?:session|usage|weekly|monthly|spending) limit.{0,30}(?:reached|exceeded)/i.test(
      error,
    );
  const rate =
    /\b429\b|rate_limit_exceeded|rate_limit_error|too many requests|rate limit/i.test(
      error,
    );
  if (!usage && !rate) return undefined;
  return {
    kind: usage ? "usage_limit" : "rate_limit",
    provider,
    resetHint: error.match(/\bresets?\s+([^\n"}]+)/i)?.[1]?.trim(),
    automaticRetry: false,
    action:
      "Wait for provider availability, then send an explicit continuation. Report this failure to the user.",
  };
}
