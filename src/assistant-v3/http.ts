import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
  type Router
} from "express";
import { z } from "zod";

import type { AssistantResponse, SupportedLocale } from "./contracts.js";
import {
  parseSignedOrderHandoff,
  type OrderHandoffScreenState,
  type SignedOrderHandoff
} from "./order-handoff.js";

export const V3_HTTP_MESSAGE_MAX_CHARACTERS = 2_000;
export const V3_HTTP_SESSION_TOKEN_MAX_CHARACTERS = 4_096;

export interface V3HttpCreatedSession {
  sessionToken: string;
  sessionId: string;
  conversationId: string;
  locale: SupportedLocale;
  expiresAt: string;
  consent: {
    status: "granted" | "required";
    version: string;
    scopes: readonly string[];
  };
  capabilities: readonly string[];
}

export interface V3AssistantHttpRuntime {
  createSession(input: { locale?: SupportedLocale }): Promise<V3HttpCreatedSession>;
  message(input: {
    sessionToken: string;
    message: string;
  }): Promise<AssistantResponse>;
  confirmOrderHandoff(input: {
    sessionToken: string;
    intentId: string;
    confirmed: true;
  }): Promise<SignedOrderHandoff>;
  openOrderHandoff(input: {
    sessionToken: string;
    handoff: SignedOrderHandoff;
  }): Promise<OrderHandoffScreenState>;
}

export type V3HttpRuntimeErrorCode =
  | "invalid_request"
  | "invalid_session"
  | "forbidden"
  | "conflict"
  | "expired"
  | "rate_limited"
  | "unavailable";

/**
 * Runtime failures deliberately carry an internal message that is never sent
 * over HTTP. Only the closed error code controls the public response.
 */
export class V3HttpRuntimeError extends Error {
  readonly retryAfterSeconds: number | undefined;

  constructor(
    public readonly code: V3HttpRuntimeErrorCode,
    internalMessage: string,
    options: { retryAfterSeconds?: number } = {}
  ) {
    super(internalMessage);
    this.name = "V3HttpRuntimeError";
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

interface SafeHttpError {
  status: 400 | 401 | 403 | 409 | 410 | 429 | 503;
  code: V3HttpRuntimeErrorCode;
  message: string;
}

const SAFE_RUNTIME_ERRORS: Readonly<Record<V3HttpRuntimeErrorCode, SafeHttpError>> = {
  invalid_request: {
    status: 400,
    code: "invalid_request",
    message: "The request is invalid."
  },
  invalid_session: {
    status: 401,
    code: "invalid_session",
    message: "A valid assistant session is required."
  },
  forbidden: {
    status: 403,
    code: "forbidden",
    message: "This action is not permitted."
  },
  conflict: {
    status: 409,
    code: "conflict",
    message: "The request conflicts with the current assistant state."
  },
  expired: {
    status: 410,
    code: "expired",
    message: "The requested assistant state has expired."
  },
  rate_limited: {
    status: 429,
    code: "rate_limited",
    message: "Too many requests. Please retry later."
  },
  unavailable: {
    status: 503,
    code: "unavailable",
    message: "The assistant is temporarily unavailable."
  }
};

const localeSchema = z.enum(["en-US", "az-AZ"]);
const sessionBodySchema = z.object({ locale: localeSchema }).strict();
const normalizedMessageSchema = z
  .string()
  .transform((value) => value.normalize("NFKC").trim())
  .pipe(z.string().min(1).max(V3_HTTP_MESSAGE_MAX_CHARACTERS));
const messageBodySchema = z.object({ message: normalizedMessageSchema }).strict();
const compatibilityBodySchema = z
  .object({ message: normalizedMessageSchema, locale: localeSchema })
  .strict();
const confirmationBodySchema = z.object({ confirmed: z.literal(true) }).strict();
const openHandoffBodySchema = z.object({ handoff: z.unknown() }).strict();
const intentIdSchema = z.string().uuid();
const bearerTokenSchema = z
  .string()
  .min(16)
  .max(V3_HTTP_SESSION_TOKEN_MAX_CHARACTERS)
  .regex(/^[A-Za-z0-9._~-]+$/u);
const createdSessionSchema: z.ZodType<V3HttpCreatedSession> = z
  .object({
    sessionToken: bearerTokenSchema,
    sessionId: z.string().uuid(),
    conversationId: z.string().uuid(),
    locale: localeSchema,
    expiresAt: z.string().datetime({ offset: true }),
    consent: z
      .object({
        status: z.enum(["granted", "required"]),
        version: z.string().min(1).max(128),
        scopes: z.array(z.string().min(1).max(128)).max(64)
      })
      .strict(),
    capabilities: z.array(z.string().min(1).max(128)).max(64)
  })
  .strict();

type AsyncRequestHandler = (request: Request, response: Response) => Promise<void>;

function asyncHandler(handler: AsyncRequestHandler): RequestHandler {
  return (request, response, next) => {
    void handler(request, response).catch(next);
  };
}

function sendSafeError(response: Response, error: SafeHttpError): void {
  response.status(error.status).json({
    error: {
      code: error.code,
      message: error.message
    }
  });
}

function bearerSessionToken(request: Request): string | null {
  const authorization = request.get("authorization");
  if (!authorization) return null;
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/iu.exec(authorization);
  if (!match?.[1]) return null;
  const parsed = bearerTokenSchema.safeParse(match[1]);
  return parsed.success ? parsed.data : null;
}

function requireSessionToken(request: Request, response: Response): string | null {
  const token = bearerSessionToken(request);
  if (token === null) {
    sendSafeError(response, SAFE_RUNTIME_ERRORS.invalid_session);
  }
  return token;
}

function validatedRuntimeSession(value: V3HttpCreatedSession): V3HttpCreatedSession {
  const parsed = createdSessionSchema.safeParse(value);
  if (!parsed.success) {
    throw new V3HttpRuntimeError(
      "unavailable",
      "The runtime returned an invalid session boundary response."
    );
  }
  return parsed.data;
}

function isBodyParserFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const type = (error as { type?: unknown }).type;
  return (
    type === "entity.parse.failed" ||
    type === "entity.too.large" ||
    type === "request.aborted" ||
    type === "encoding.unsupported"
  );
}

function safeErrorFor(error: unknown): SafeHttpError {
  if (error instanceof V3HttpRuntimeError) {
    return SAFE_RUNTIME_ERRORS[error.code] ?? SAFE_RUNTIME_ERRORS.unavailable;
  }
  if (isBodyParserFailure(error)) return SAFE_RUNTIME_ERRORS.invalid_request;
  return SAFE_RUNTIME_ERRORS.unavailable;
}

/**
 * Creates the customer HTTP boundary without constructing authentication,
 * workflow, persistence, or provider dependencies. Those remain behind the
 * injected runtime port.
 */
export function createV3HttpRouter(runtime: V3AssistantHttpRuntime): Router {
  const router = express.Router();
  const mountedPaths = ["/v1/assistant", "/api/chat"];

  router.use(mountedPaths, (_request, response, next) => {
    response.set("cache-control", "no-store");
    response.set("x-content-type-options", "nosniff");
    next();
  });
  router.use(mountedPaths, express.json({ limit: "16kb", strict: true }));

  router.post(
    "/v1/assistant/sessions",
    asyncHandler(async (request, response) => {
      const parsed = sessionBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        sendSafeError(response, SAFE_RUNTIME_ERRORS.invalid_request);
        return;
      }
      const session = validatedRuntimeSession(
        await runtime.createSession({ locale: parsed.data.locale })
      );
      response.status(201).json(session);
    })
  );

  router.post(
    "/v1/assistant/messages",
    asyncHandler(async (request, response) => {
      const token = requireSessionToken(request, response);
      if (token === null) return;
      const parsed = messageBodySchema.safeParse(request.body);
      if (!parsed.success) {
        sendSafeError(response, SAFE_RUNTIME_ERRORS.invalid_request);
        return;
      }
      response.status(200).json(
        await runtime.message({
          sessionToken: token,
          message: parsed.data.message
        })
      );
    })
  );

  router.post(
    "/v1/assistant/order-handoffs/:intentId/confirm",
    asyncHandler(async (request, response) => {
      const token = requireSessionToken(request, response);
      if (token === null) return;
      const intentId = intentIdSchema.safeParse(request.params.intentId);
      const confirmation = confirmationBodySchema.safeParse(request.body);
      if (!intentId.success || !confirmation.success) {
        sendSafeError(response, SAFE_RUNTIME_ERRORS.invalid_request);
        return;
      }
      response.status(200).json(
        await runtime.confirmOrderHandoff({
          sessionToken: token,
          intentId: intentId.data,
          confirmed: confirmation.data.confirmed
        })
      );
    })
  );

  router.post(
    "/v1/assistant/order-handoffs/open",
    asyncHandler(async (request, response) => {
      const token = requireSessionToken(request, response);
      if (token === null) return;
      const body = openHandoffBodySchema.safeParse(request.body);
      const handoff = body.success
        ? parseSignedOrderHandoff(body.data.handoff)
        : null;
      if (handoff === null) {
        sendSafeError(response, SAFE_RUNTIME_ERRORS.invalid_request);
        return;
      }
      response.status(200).json(
        await runtime.openOrderHandoff({
          sessionToken: token,
          handoff
        })
      );
    })
  );

  router.post(
    "/api/chat",
    asyncHandler(async (request, response) => {
      const parsed = compatibilityBodySchema.safeParse(request.body);
      if (!parsed.success) {
        sendSafeError(response, SAFE_RUNTIME_ERRORS.invalid_request);
        return;
      }
      const session = validatedRuntimeSession(
        await runtime.createSession({ locale: parsed.data.locale })
      );
      response.status(200).json(
        await runtime.message({
          sessionToken: session.sessionToken,
          message: parsed.data.message
        })
      );
    })
  );

  router.use(
    (error: unknown, _request: Request, response: Response, next: NextFunction) => {
      if (response.headersSent) {
        next(error);
        return;
      }
      const safe = safeErrorFor(error);
      if (error instanceof V3HttpRuntimeError && error.code === "rate_limited") {
        const retryAfter = error.retryAfterSeconds;
        if (
          retryAfter !== undefined &&
          Number.isSafeInteger(retryAfter) &&
          retryAfter > 0 &&
          retryAfter <= 3_600
        ) {
          response.set("retry-after", String(retryAfter));
        }
      }
      sendSafeError(response, safe);
    }
  );

  return router;
}
