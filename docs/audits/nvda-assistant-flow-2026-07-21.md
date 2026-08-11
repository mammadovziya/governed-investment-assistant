# NVDA assistant flow audit — 21 July 2026

> Archived pre-V3 audit: the screenshots, runtime counts, file paths, and root-cause analysis below describe the retired implementation. They are retained as migration evidence, not as current operating documentation. See `ARCHITECTURE.md` and `docs/production-readiness.md` for the active runtime.

## V3 disposition

The ground-up V3 cutover replaces the audited implementation with a fixed registry of 3 tool-less writer agents, 5 deterministic workflows, 10 grant-gated boundary tools, and 7 blocking response scorers. The authoritative lifecycle is trusted context → deterministic routing and policy → signed tools and facts → constrained writer → deterministic rendering → blocking scorers → durable audit commit → response.

Current verification covers differentiated research/risk/news routes, AZ/EN portfolio requests, bounded symbol follow-ups, signed evidence lineage, governed product citations, fixed-point portfolio math, accessible 10-year charts, and an explicit suspend/resume order-ticket handoff. Public research uses a development-only live feed and client data remains synthetic; customer-production readiness therefore intentionally fails closed.

## Audit scope

Combined UX and accessibility audit of the local investment assistant at `http://localhost:3000/`, focused on intent routing and answer depth for stock research, single-stock risk, Azerbaijani portfolio explanation, and portfolio-change questions. A user-supplied reference-assistant transcript was used only as comparison context.

## User goal and accessibility target

The user expects the assistant to distinguish a price lookup from analysis, risk analysis, sentiment, indicators, and portfolio questions, then provide source-backed information in the requested language. Responses should remain readable, keyboard reachable, and clear about data freshness and limitations.

## Captured flow

1. **Start state — healthy.** The assistant sets a factual, non-execution boundary and exposes relevant example prompts.
2. **“analyze NVDA” — poor.** The answer contains only the current quote and a 10-year chart. It does not include a company overview, fundamentals, valuation, earnings, catalysts, risks, or cited reporting.
3. **“risk anaylsis for NVDA” — poor.** The same quote workflow runs again. Because the typo is not recognized by the UI-only range heuristic, the only material change is a 1-year chart instead of a 10-year chart; no risk analysis appears.
4. **“Portfelimin gəlirini izah et” — broken.** Azerbaijani inflection is not recognized, so the request falls to a generic English deterministic response that inaccurately tells the user to start Ollama even though the UI reports local Ollama as active.
5. **“What changed in my portfolio?” — misleading.** The assistant returns a current portfolio snapshot, not a comparison against any previous value or explicit baseline.

The original local captures are intentionally excluded from the public source
tree because they contain downstream branding and time-sensitive market data.

## Strengths

- Current-price claims are grounded by a required Market Analyst tool call and show source, market state, timestamp, and freshness.
- The interactive chart has clear range controls, keyboard point inspection, source attribution, and a strong visual hierarchy.
- The assistant avoids fabricating fundamentals, news, analyst targets, or sentiment that it did not fetch.
- Portfolio values are deterministic and traceable to the mock account rather than model arithmetic.

## UX risks and root causes

### P0 — Symbol-first routing collapses distinct tasks

`PolicyService` has no security-analysis, indicators, sentiment, news, comparison, or security-risk intent. Any extracted uppercase ticker is a catch-all `market_facts → market-brief` route in `src/services/policy.ts:109`. Consequently, `analyze NVDA` and `risk analysis for NVDA` both enter the quote-only Market Brief branch in `src/mastra/workflows.ts:715`.

The word “analyze” affects only the frontend chart default in `public/app.js:324`; it does not change backend research depth. The misspelled “anaylsis” is not recognized there, which explains the observed 1-year chart.

### P0 — The required evidence tools do not exist

The market workflow can fetch a quote, but there are no registered tools for company profile, fundamentals, fiscal periods, earnings, valuation, analyst consensus, current news, sentiment inputs, or calculated single-stock risk. A prompt change cannot safely reproduce reference-assistant depth; the assistant needs typed data adapters and required-tool evaluations for each intent.

### P0 — Portfolio routes are declared but not executed

The assistant router executes explicit branches only for `market-brief` and `investment-research`, then falls through to `ChatService` at `src/mastra/workflows.ts:778`. Even though the policy selects `portfolio-review`, that registered workflow is not run. `ChatService` deliberately short-circuits portfolio facts to one deterministic paragraph at `src/services/chat.ts:75`.

“What changed?” cannot be answered correctly because the data model stores only the current `PortfolioSummary`; there is no prior snapshot or selected baseline.

### P0 — Azerbaijani morphology is missed

The strict word-boundary patterns in `src/services/policy.ts:34` match bare `portfel` and `gəlir`, but not inflected `Portfelimin` and `gəlirini`. The request is classified as generic education, and a model failure reaches the hard-coded English MVP fallback at `src/services/chat.ts:224`.

### P1 — Internal implementation state leaks into customer copy

`DETERMINISTIC RESPONSE`, tool IDs, and “Start local Ollama…” are engineering diagnostics, not useful customer-facing provenance. They reduce trust, especially when the UI simultaneously says Ollama is active. Customer provenance should use plain-language source and freshness labels; detailed tool/run evidence belongs in Mastra Studio.

### P1 — Conversation context is not used for drill-down

The reference assistant treats “NVDA indicators,” “sentiment analysis,” and “what else?” as follow-ups on the same entity and changes the evidence bundle. The audited build independently reroutes each message and does not carry an active security or research state.

## Accessibility risks

- The all-caps provenance strip and chart-source copy render at very small sizes; they are technically present but difficult to read at normal zoom.
- Long answers and charts share a fixed-height internal scroll region, so earlier content can be hidden while the input stays visible. Reading order is understandable in the DOM, but keyboard and screen-reader behavior across multiple long responses still needs dedicated testing.
- The same visual response pattern for quote and risk questions gives weak state-change feedback; users must read the text closely to realize no risk analysis occurred.

No claim of full WCAG compliance is made from this screenshot-based audit.

## Reference-assistant comparison context

The reference assistant is stronger at intent depth and response structure: it separates overview, indicators, sentiment, news/catalysts, valuation, analyst consensus, and contextual follow-ups. The local assistant should adopt that task differentiation and conversational continuity.

The reference assistant is not a complete trust benchmark. The supplied transcript has unresolved `[1]`/`[2]` references, small quote inconsistencies, highly precise figures without visible fiscal/source metadata, and a prominent internal `BUY` rating that can read as advice. This project should retain its stronger tool grounding and neutral boundary.

## Recommended response architecture

`request → intent + ticker + language router → typed workflow plan → parallel evidence tools → normalized evidence object → citation/freshness/numeric validators → qwen3:0.6b evidence-constrained narrative → policy post-check → typed UI sections`

Recommended orthogonal intents:

- `market_quote`
- `security_overview`
- `fundamental_analysis`
- `security_risk`
- `security_sentiment_news`
- `historical_technical`
- `security_compare`
- `investment_decision_support`
- `portfolio_snapshot`
- `portfolio_change`
- `portfolio_risk`
- `portfolio_explanation`

Each intent needs mandatory tool-call evaluations. Examples: overview requires profile + quote + fundamentals; risk requires price history/risk calculations plus sourced business risks; sentiment requires timestamped news evidence and opposing signals; portfolio change requires an explicit baseline.

## Evidence limits

- Reference-assistant behavior was supplied as text, not captured from a live product.
- The audit confirms the local assistant flow and routing behavior, but it does not validate any third-party fundamental/news provider or licensing terms.
- No implementation changes were made during this diagnostic audit.
