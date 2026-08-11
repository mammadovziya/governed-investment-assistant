import { describe, expect, it } from "vitest";

describe("offline test harness", () => {
  it("replaces contributor credentials before source imports", () => {
    expect(process.env.OPENAI_API_KEY).toBe(
      "vitest-disabled-no-provider-access"
    );
  });

  it("blocks outbound provider requests", async () => {
    await expect(
      fetch("https://api.openai.com/v1/responses")
    ).rejects.toThrow("vitest_outbound_network_disabled");
  });
});
