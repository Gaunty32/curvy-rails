/**
 * Safe setup-only server shell for the sanitised transfer.
 *
 * The historical router is deliberately not imported here. It contains
 * integrations and routes that require the outbound gate and activation
 * review. This shell exposes only local setup/status endpoints.
 */
import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import setupRouter from "./setup/setup-routes.js";
import { operationalAccess } from "./setup/operational-access.js";
import { logger } from "./lib/logger.js";

const app: Express = express();
app.set("trust proxy", process.env.TRUST_PROXY === "false" ? false : 1);
app.set("etag", false);
app.use(pinoHttp({ logger }));
app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(",").map((value) => value.trim()).filter(Boolean) ?? false }));
app.use(express.json({ limit: "64kb" }));
app.use(express.urlencoded({ extended: false, limit: "16kb" }));
app.use(["/api", "/"], (_request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  next();
});
app.use("/api", setupRouter);
app.use("/", setupRouter);
// Historical routes are resolved on demand, and only after operationalAccess
// confirms local installation activation in the database.
app.use("/api", operationalAccess);
app.use("/", operationalAccess);

export default app;