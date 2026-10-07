import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useFeeds } from "./Feeds.jsx";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function Probe({ paths }) {
  const [feeds, files, ready, , publication] = useFeeds(paths);
  return <>{feeds}<div data-testid="result">{ready ? `${publication.mismatch ? "mixed" : "ready"}:${Object.values(files).map((d) => d?.value).join(",")}` : "loading"}</div></>;
}

it("retries a mixed publication once and recovers to a consistent snapshot", async () => {
  const reads = new Map();
  const fetch = vi.fn(async (url) => {
    const path = url.split("/").at(-1), n = (reads.get(path) || 0) + 1; reads.set(path, n);
    return { ok: true, json: async () => ({ publication_revision: n === 1 ? path : "together", value: n }) };
  });
  vi.stubGlobal("fetch", fetch);
  render(<Probe paths={["feeds-recovery-a.json", "feeds-recovery-b.json"]} />);
  await waitFor(() => expect(screen.getByTestId("result").textContent).toBe("ready:2,2"));
  expect(fetch).toHaveBeenCalledTimes(4);
});

it("keeps persistent disagreement visible, does not loop, and supports manual retry", async () => {
  const fetch = vi.fn(async (url) => ({ ok: true, json: async () => ({ publication_revision: url.split("/").at(-1), value: 1 }) }));
  vi.stubGlobal("fetch", fetch);
  render(<Probe paths={["feeds-persist-a.json", "feeds-persist-b.json"]} />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
  await waitFor(() => expect(screen.getByRole("button", { name: "Retry snapshot" })).toBeTruthy());
  expect(screen.getByRole("status").textContent).toContain("different publications");
  fireEvent.click(screen.getByRole("button", { name: "Retry snapshot" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(6));
});
