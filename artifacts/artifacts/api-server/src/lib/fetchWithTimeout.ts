const DEFAULT_TIMEOUT_MS = 15_000;

export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw Object.assign(new Error("Upstream request timed out"), { status: 504 });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}