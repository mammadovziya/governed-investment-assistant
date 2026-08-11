// Install test-only environment values before any source module can load
// `.env.local`. This prevents local contributor credentials from entering an
// automated test process.
process.env.NODE_ENV = "test";
process.env.OPENAI_API_KEY = "vitest-disabled-no-provider-access";
process.env.ASSISTANT_DEMO_MARKET_PROVIDER = "synthetic-offline";

const nativeFetch = globalThis.fetch.bind(globalThis);

function requestUrl(input: Parameters<typeof fetch>[0]): URL | null {
  const raw =
    typeof input === "string" || input instanceof URL
      ? String(input)
      : input.url;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function isLoopback(url: URL): boolean {
  return (
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" ||
      url.hostname === "localhost" ||
      url.hostname === "[::1]")
  );
}

globalThis.fetch = (async (input, init) => {
  const url = requestUrl(input);
  if (url === null || !isLoopback(url)) {
    throw new Error("vitest_outbound_network_disabled");
  }
  return nativeFetch(input, init);
}) as typeof fetch;
