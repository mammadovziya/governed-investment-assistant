import { describe, expect, it } from "vitest";

import {
  safeV3LogFields,
  safeV3LogMessage
} from "../src/assistant-v3/logging.js";

describe("V3 infrastructure logging boundary", () => {
  it("retains only bounded operational fields", () => {
    expect(
      safeV3LogFields({
        method: "POST",
        route: "assistant_message",
        statusCode: 200,
        durationMs: 42,
        signal: "SIGTERM",
        errorName: "AbortError",
        aborted: false,
        prompt: "Should I buy NVDA?",
        requestId: "request-private",
        error: new Error("account-private"),
        nested: {
          headers: {
            authorization: "Bearer private"
          }
        }
      })
    ).toEqual({
      method: "POST",
      route: "assistant_message",
      statusCode: 200,
      durationMs: 42,
      signal: "SIGTERM",
      errorName: "AbortError",
      aborted: false
    });
  });

  it("rejects invalid field values and unreviewed framework messages", () => {
    expect(
      safeV3LogFields({
        method: "TRACE",
        route: "customer message",
        statusCode: 999,
        durationMs: -1,
        signal: "SIGHUP",
        errorName: "Error: account-private",
        aborted: "false"
      })
    ).toEqual({});
    expect(safeV3LogMessage("Prompt: should I buy NVDA?")).toBe(
      "Mastra runtime event"
    );
    expect(safeV3LogMessage("HTTP request completed")).toBe(
      "HTTP request completed"
    );
    expect(
      safeV3LogMessage("Prompt: should I buy NVDA?", true)
    ).toBe("Prompt: should I buy NVDA?");
  });
});
