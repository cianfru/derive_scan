/** Observation times stay separate; older published documents may have no revision metadata. */
export function publicationState(documents, anchorRevision = null) {
  const revisions = [...new Set([anchorRevision, ...documents.map((d) => d?.publication_revision)]
    .filter((r) => typeof r === "string" && r.length > 0))];
  return { revision: revisions.length === 1 ? revisions[0] : null, revisions, mismatch: revisions.length > 1 };
}
