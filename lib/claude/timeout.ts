// STACKD TRADER — function-level Claude timeout.
//
// Belt-and-suspenders on top of the Anthropic SDK's own per-request timeout.
// The SDK timeout aborts a single fetch; this helper hard-stops the whole
// async chain (parse, log, persist) at the outer function boundary so a slow
// Claude call can never block the bot loop longer than the configured ceiling.
//
// Both timeouts AND rejections resolve to the same fallback — the original
// helper only handled timeouts and would re-throw on errors. Bot must keep
// trading either way.

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
  label?: string,
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;
  let timedOut = false;

  const timeoutPromise = new Promise<T>((resolve) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      console.warn(
        `[withTimeout] ${label ?? 'call'} timed out after ${timeoutMs}ms; using fallback`,
      );
      resolve(fallback);
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    return result;
  } catch (err) {
    if (!timedOut) {
      console.warn(
        `[withTimeout] ${label ?? 'call'} rejected: ${(err as Error).message}; using fallback`,
      );
    }
    return fallback;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}
