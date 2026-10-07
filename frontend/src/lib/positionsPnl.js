const sum = (rows, pick) => rows.reduce((a, r) => a + pick(r), 0);

export function pnlCoverage(views, summary, pendingSettlementCount = 0) {
  const priced = views.filter((v) => !v.pendingReceipt && v.p.journal?.cost?.fees_basis !== "unknown" && Number.isFinite(v.f.plNow));
  const valued = views.filter((v) => !v.pendingReceipt && Number.isFinite(v.f.valueNow));
  const knownResults = summary.count - summary.unknown;
  const unknownOpen = views.length - priced.length;
  const incomplete = unknownOpen > 0 || summary.unknown > 0 || pendingSettlementCount > 0;
  const known = priced.length + knownResults;
  const open = views.length ? priced.length ? sum(priced, (v) => v.f.plNow) : null : 0;
  const realized = summary.count ? knownResults ? summary.total : null : 0;
  return {
    open, realized,
    total: !known && incomplete ? null : (open ?? 0) + (realized ?? 0),
    inPositions: views.length ? valued.length ? sum(valued, (v) => v.f.valueNow) : null : 0,
    incomplete, knownOpen: priced.length, unknownOpen, knownResults,
    pendingSettlementCount,
    estimated: summary.estimated > 0 || priced.some((v) => v.p.journal?.cost?.fees_basis === "estimated"),
  };
}
