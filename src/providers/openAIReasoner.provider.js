const { REASONING_INSTRUCTIONS } = require("./geminiReasoner.provider");
// Configurable adapter, not an assertion about an unverified reseller endpoint/model.
class OpenAIReasonerProvider {
  constructor({ baseURL, apiKey, model, fetchImpl = fetch }) {
    const url = new URL(baseURL);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      throw new Error("Fallback base URL must be a clean HTTPS API URL");
    }
    if (!apiKey || !model) throw new Error("Fallback key and model are required");
    this.endpoint = baseURL.replace(/\/$/, "") + "/chat/completions";
    this.apiKey = apiKey; this.model = model; this.fetch = fetchImpl;
  }
  async reason({ context, signal, timeoutMs = 15000 }) {
    // This adapter's vision support is unverified. Never silently drop an image.
    if (context.images?.length) throw new Error("Image requests require the Gemini primary provider");
    const response = await this.fetch(this.endpoint, {
      method: "POST", signal: signal || AbortSignal.timeout(timeoutMs),
      headers: { "Authorization": `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, stream: false, max_tokens: 1800,
        response_format: { type: "json_object" }, messages: [
          { role: "system", content: REASONING_INSTRUCTIONS },
          { role: "user", content: JSON.stringify(context) },
        ] }),
    });
    if (!response.ok) {
      const error = new Error(`Fallback service returned HTTP ${response.status}`);
      error.status = response.status; throw error;
    }
    const body = await response.json();
    const choice = body.choices?.[0];
    if (choice?.finish_reason !== "stop" || typeof choice.message?.content !== "string") {
      throw new Error("Fallback returned incomplete reasoning output");
    }
    try { return JSON.parse(choice.message.content); }
    catch { throw new Error("Fallback returned invalid reasoning JSON"); }
  }
}
module.exports = { OpenAIReasonerProvider };
