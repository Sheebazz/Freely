const { GeminiReasonerProvider } = require("./geminiReasoner.provider");
const { OpenAIReasonerProvider } = require("./openAIReasoner.provider");
const { RoutedReasonerProvider } = require("./routedReasoner.provider");
function createReasoner(env = process.env, { onAttempt = () => {} } = {}) {
  const primary = new GeminiReasonerProvider({ apiKey: env.GEMINI_API_KEY,
    model: env.GEMINI_REASONING_MODEL || "gemini-3.5-flash" });
  const fallback = env.REASONING_FALLBACK_ENABLED === "true" ? new OpenAIReasonerProvider({
    baseURL: env.REASONING_FALLBACK_BASE_URL, apiKey: env.REASONING_FALLBACK_API_KEY,
    model: env.REASONING_FALLBACK_MODEL,
  }) : null;
  return new RoutedReasonerProvider({ primary, fallback, onAttempt: route =>
    onAttempt({ route, model: (route === "primary" ? primary : fallback).model }) });
}
module.exports = { createReasoner };
