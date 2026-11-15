import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";
import { api } from "./routes.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          // Inline style attributes are used for a few one-off layout values.
          styleSrc: ["'self'", "https://fonts.googleapis.com"],
          styleSrcAttr: ["'unsafe-inline'"],
          fontSrc: ["https://fonts.gstatic.com"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          workerSrc: ["'self'", "blob:"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );

  app.use(express.json({ limit: "400kb" }));

  app.use(
    "/api",
    rateLimit({
      windowMs: config.rateLimitWindowMs,
      limit: config.rateLimitMax,
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => req.path === "/health",
      message: { error: "Too many requests. Wait a few minutes and try again." },
    }),
    api,
  );

  // Browser copies of the file readers, served from node_modules so no CDN is needed.
  app.use("/vendor/pdfjs", express.static(path.join(root, "node_modules/pdfjs-dist/build")));
  app.use("/vendor/mammoth", express.static(path.join(root, "node_modules/mammoth")));
  app.use(express.static(path.join(root, "public")));

  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err?.type === "entity.too.large") {
      const n = (x) => x.toLocaleString("en-US");
      return res.status(413).json({
        error: `That text is too large to send. A CV or vacancy can be up to ${n(config.maxDocChars)} characters and each answer up to ${n(config.maxAnswerChars)}. Shorten it and try again.`,
      });
    }
    if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "The request was not valid JSON." });
    const status = err?.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    if (status === 500) console.error("[server]", err);
    res.status(status).json({ error: status === 500 ? "Something went wrong on the server." : err.message });
  });

  return app;
}
