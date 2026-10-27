/** null is the JSON-safe representation of no application concurrency limit. */
export function parseConcurrency(value?: string): number | null {
  if (value === undefined || value === "unlimited") return null;
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new Error(
      "ORCHESTRATOR_CONCURRENCY_PER_DEPTH must be unlimited or a positive safe integer",
    );
  return Number(value);
}
