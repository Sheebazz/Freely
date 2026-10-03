// At most two attempts. Only availability errors permit switching providers.
function unavailable(error) {
  const status = Number(error.status ?? error.statusCode ?? error.code);
  return [408, 429, 500, 502, 503, 504].includes(status)
    || ["AbortError", "TimeoutError", "APIConnectionTimeoutError"].includes(error.name)
    || ["ETIMEDOUT", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN"].includes(error.code)
    || (error instanceof TypeError && /fetch failed/i.test(error.message));
}
async function attempt(provider, context, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      const error = new Error("Reasoning request timed out");
      error.name = "TimeoutError"; reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([provider.reason({ context, signal: controller.signal, timeoutMs }), deadline]);
  } finally { clearTimeout(timer); }
}
class RoutedReasonerProvider {
  constructor({ primary, fallback = null, primaryTimeoutMs = 35000, fallbackTimeoutMs = 15000,
    cooldownMs = 60000, now = Date.now, onAttempt = () => {} }) {
    this.primary = primary; this.fallback = fallback;
    this.primaryTimeoutMs = primaryTimeoutMs; this.fallbackTimeoutMs = fallbackTimeoutMs;
    this.cooldownMs = cooldownMs; this.now = now; this.onAttempt = onAttempt;
    this.blockedUntil = 0;
  }
  async reason({ context }) {
    if (this.fallback && this.now() < this.blockedUntil) {
      this.onAttempt("fallback"); return attempt(this.fallback, context, this.fallbackTimeoutMs);
    }
    try { this.onAttempt("primary"); return await attempt(this.primary, context, this.primaryTimeoutMs); }
    catch (error) {
      if (!this.fallback || !unavailable(error)) throw error;
      this.blockedUntil = this.now() + this.cooldownMs;
      this.onAttempt("fallback"); return attempt(this.fallback, context, this.fallbackTimeoutMs);
    }
  }
}
module.exports = { RoutedReasonerProvider, unavailable };
