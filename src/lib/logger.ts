import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: {
    paths: ["key", "secret", "token", "password", "fileContent", "sdp"],
    censor: "[REDACTED]",
  },
  browser: {
    asObject: true,
  },
});
