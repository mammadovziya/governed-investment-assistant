# Design QA — historical stock chart

## Source truth and implementation

- Source reference: private design reference and local QA captures (not
  distributed with this repository)
- Tested state: `should I invest INTC`, real `10Y` history selected, latest available close shown, both research specialists completed.
- Viewports: default desktop `1280 × 720`; explicit mobile QA `390 × 844`, reset to the default viewport after testing.

## Comparison passes

### Full view

- The existing downstream dashboard remains the primary desktop frame; the historical chart is intentionally nested in the assistant response instead of replacing the dashboard.
- The assistant provenance makes the workflow visible: Investment Research, Market Analyst, Risk & Compliance Reviewer, quote source, and grounding result are all present.
- The chart retains the reference's hierarchy: instrument identity, large price, period change, dominant plot, and a segmented range control.

### Focused chart

- Typography: DM Sans and Manrope preserve the dashboard's product typography while matching the reference's large price/smaller metadata hierarchy. Values and date labels remain legible at phone width.
- Spacing and layout: the dark chart card uses compact padding, rounded corners, a large plot region, and a single horizontal time-range control. It fits within `390px` without document-level horizontal overflow.
- Colors and tokens: the near-black green surface, mint line/positive state, muted gray axes, and dark selected range adapt the black/teal reference to the downstream palette with sufficient contrast.
- Image and data quality: no static or fabricated stock image is used. The canvas renders normalized real historical closes at device-pixel density; the NVIDIA logo from the reference was deliberately not reused for Intel.
- Copy: “Latest close,” selected range, source, and as-of timestamp accurately describe historical data. The surrounding answer explicitly states that current quote data alone cannot determine whether an investment is appropriate.
- Icons: no reference icon or issuer logo was substituted with CSS art. Existing interface icons remain consistent with the dashboard.

## Responsiveness and accessibility

- Initial mobile QA found grid min-content overflow from desktop cards. Fixed with zero-minimum grid items, `minmax(0, 1fr)`, responsive performance metrics, and narrower assistant padding.
- Desktop and mobile cards no longer overlap or force the document wider than the viewport; the holdings table retains its own horizontal scroller.
- Chart canvas has an accessible name, focus indicator, reduced-motion-safe static drawing, and keyboard point inspection with Arrow keys/Home/End.
- Range controls are semantic buttons with pressed, disabled/loading, hover, and focus states; mobile tap targets remain practical.
- Loading, success, empty/error, and retry paths are implemented. Browser console QA reported no warnings or errors.

## Interaction verification

- `10Y` default loaded 523 weekly INTC points from July 2016 through July 2026.
- Switching to `5Y` updated the selected state and changed the computed period result to `+$44.06 (+83.13%)`; switching back restored `10Y` at `+$62.40 (+180.03%)`.
- Keyboard `Home` exposed `$34.66 · Jul 18, 2016`; `End` exposed `$97.06 · Jul 20, 2026` in the live tooltip.
- Exact investment question ran Market Analyst and Risk & Compliance Reviewer and displayed a grounded neutral research response instead of the previous instant deterministic refusal.

final result: passed
