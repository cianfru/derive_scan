# Cowboy coin detail design preview

Production source: `d2e9d6f4e38497e814c538ba9dbd46c0d4c675c7` (PR #76).
Published data: `584035d6ff2e1f0937f91427581505fd337cdf69` on site-data.
Snapshot: 5 October 2026, 21:17:33 UTC; options quotes at 21:15 UTC.

This standalone HTML runs the actual application with HashRouter and exact embedded published fixtures. Fonts and coin icons are embedded. Its clock is frozen at the snapshot, analytics are omitted, and trading is disabled. It makes no exchange or data requests. The visible preview banner identifies its snapshot.

All 15 coin routes work through `#/coin/<SYMBOL>`. The initial route is BTC. Markets, Saloon and the referenced holder profiles are available for navigation review.

The generated artifact belongs only on this preview branch. PR #76 contains production source changes; no generated preview is included in that PR.
