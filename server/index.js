import { createApp } from "./app.js";
import { config } from "./config.js";

if (!config.mock && !config.apiKey) {
  console.warn(
    "ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add a key, or run with MOCK_AI=1 for canned responses.",
  );
}

createApp().listen(config.port, () => {
  console.log(`Offerlens running on http://localhost:${config.port}${config.mock ? " (mock AI)" : ""}`);
});
