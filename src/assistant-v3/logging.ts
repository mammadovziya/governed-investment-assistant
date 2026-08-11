import {
  PinoLogger,
  type PinoLoggerOptions
} from "@mastra/loggers";

import { config } from "../config.js";

const REVIEWED_LOG_MESSAGES = new Set([
  "HTTP request completed",
  "HTTP request failed",
  "Graceful shutdown started",
  "Graceful shutdown deadline reached",
  "Graceful shutdown failed"
]);

const SAFE_STRING_FIELDS = Object.freeze({
  method: /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/u,
  route: /^[a-z][a-z0-9_-]{0,63}$/u,
  completionEvent: /^(?:finish|close)$/u,
  signal: /^(?:SIGINT|SIGTERM)$/u,
  errorName: /^[A-Za-z][A-Za-z0-9]{0,63}$/u,
  component: /^[a-z][a-z0-9_.-]{0,63}$/u,
  operation: /^[a-z][a-z0-9_.-]{0,63}$/u,
  result: /^[a-z][a-z0-9_.-]{0,63}$/u,
  status: /^[a-z][a-z0-9_.-]{0,63}$/u
});

export type V3SafeLogFields = Readonly<Record<string, unknown>>;

/**
 * Projects arbitrary framework metadata onto a tiny operational allow-list.
 * Customer text, evidence, identifiers, prompts, errors, headers, inputs,
 * outputs, and tool results are dropped rather than recursively redacted.
 */
export function safeV3LogFields(
  input: Readonly<Record<string, unknown>> | undefined
): Record<string, string | number | boolean> {
  if (input === undefined) return {};
  const output: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "boolean") {
      if (key === "aborted") output[key] = value;
      continue;
    }
    if (typeof value === "number") {
      if (
        Number.isFinite(value) &&
        (
          (key === "statusCode" && value >= 100 && value <= 599) ||
          (key === "durationMs" && value >= 0 && value <= 86_400_000)
        )
      ) {
        output[key] = value;
      }
      continue;
    }
    if (typeof value !== "string") continue;
    const rule = SAFE_STRING_FIELDS[
      key as keyof typeof SAFE_STRING_FIELDS
    ];
    if (rule?.test(value)) output[key] = value;
  }
  return output;
}

export function safeV3LogMessage(
  message: string,
  retainMessage = false
): string {
  return retainMessage || REVIEWED_LOG_MESSAGES.has(message)
    ? message
    : "Mastra runtime event";
}

/**
 * Pino's path redaction is useful only after this projection. Mastra may log
 * nested framework objects or stringify error details into messages, so the
 * logger wrapper treats every framework call as untrusted input.
 */
export class V3SafePinoLogger extends PinoLogger {
  readonly #retainMessages: boolean;

  constructor(
    options: PinoLoggerOptions & { readonly retainMessages?: boolean } = {}
  ) {
    const { retainMessages = false, ...pinoOptions } = options;
    super(pinoOptions);
    this.#retainMessages = retainMessages;
  }

  override child(_bindings: Record<string, unknown>): V3SafePinoLogger {
    // Correlation identifiers are intentionally not bound into infrastructure
    // logs. Redacted OpenTelemetry spans carry the approved correlation data.
    return this;
  }

  override debug(message: string, args?: Record<string, unknown>): void {
    super.debug(
      safeV3LogMessage(message, this.#retainMessages),
      safeV3LogFields(args)
    );
  }

  override info(message: string, args?: Record<string, unknown>): void {
    super.info(
      safeV3LogMessage(message, this.#retainMessages),
      safeV3LogFields(args)
    );
  }

  override warn(message: string, args?: Record<string, unknown>): void {
    super.warn(
      safeV3LogMessage(message, this.#retainMessages),
      safeV3LogFields(args)
    );
  }

  override error(message: string, args?: Record<string, unknown>): void {
    super.error(
      safeV3LogMessage(message, this.#retainMessages),
      safeV3LogFields(args)
    );
  }
}

export const v3Logger = new V3SafePinoLogger({
  name: "GovernedInvestmentAssistantV3",
  level: config.logLevel,
  prettyPrint: config.environment !== "production"
});

/**
 * The private Studio is loopback-only and receives only public, approved, or
 * synthetic data. Keeping its message text makes the local Logs view useful;
 * the customer application continues to use the stricter logger above.
 */
export const v3PrivateStudioLogger = new V3SafePinoLogger({
  name: "GovernedInvestmentAssistantV3Studio",
  level: config.logLevel,
  prettyPrint: true,
  retainMessages: true
});
