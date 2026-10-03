import "dotenv/config";
import { createServer } from "node:http";
import repository from "../src/repositories/supabaseSession.repository.js";
import extractor from "../src/providers/geminiExtractor.provider.js";
import routing from "../src/providers/reasonerFactory.js";
import httpApp from "../src/http/app.js";
const port = Number(process.env.PORT || 3000);
const publicOrigin = process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL;
if (process.env.NODE_ENV === "production" && !publicOrigin) {
  throw new Error("PUBLIC_ORIGIN is required in production");
}
if (publicOrigin && new URL(publicOrigin).origin !== publicOrigin) {
  throw new Error("PUBLIC_ORIGIN must be an exact origin without a trailing slash");
}
if (process.env.NODE_ENV === "production" && new URL(publicOrigin).protocol !== "https:") {
  throw new Error("Production PUBLIC_ORIGIN must use HTTPS");
}
const server = createServer(httpApp.createApp({ repository,
  extractor: new extractor.GeminiExtractorProvider(), reasoner: routing.createReasoner(),
  publicOrigin: publicOrigin || null }));
server.requestTimeout = 90000;
server.headersTimeout = 15000;
server.listen(port, () => console.log(`Freely is listening on port ${port}`));
