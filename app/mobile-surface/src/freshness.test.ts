// ISSUE-079 — NFR-OBS.011 never-false-healthy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderCount, renderHealth, renderList, PLACEHOLDER, CANT_CONFIRM, type FetchResult } from "./freshness.ts";

// ── AC-NFR-OBS.011.1 — a failed/stale read reads "—"/"can't confirm", never "0"/"✓"/"all clear"/"Live" ──
test("AC-NFR-OBS.011.1 — a failed count reads '—', never a provisional '0'", () => {
  const err = renderCount({ status: "error", message: "network" });
  assert.equal(err.display, PLACEHOLDER);
  assert.notEqual(err.display, "0");
  assert.equal(err.confident, false);

  const ok = renderCount({ status: "ok", data: 0, fetchedAt: "t" });
  assert.equal(ok.display, "0"); // a genuine confirmed zero IS "0"
  assert.equal(ok.confident, true);
});

test("AC-NFR-OBS.011.1 — a failed OR stale health fetch never renders green/healthy", () => {
  const err = renderHealth({ status: "error", message: "x" });
  assert.equal(err.display, CANT_CONFIRM);
  assert.equal(err.healthy, false);
  assert.equal(err.confident, false);

  const stale = renderHealth({ status: "stale", data: { label: "All good", healthy: true }, fetchedAt: "t" });
  assert.equal(stale.healthy, false, "stale health is never treated as green (#3)");
  assert.equal(stale.confident, false);
  assert.match(stale.display, /can't confirm|stale/i);

  const ok = renderHealth({ status: "ok", data: { label: "Healthy", healthy: true }, fetchedAt: "t" });
  assert.equal(ok.healthy, true);
});

test("AC-NFR-OBS.011.1 — a stale-and-empty list reads 'can't confirm', never a confident empty", () => {
  const staleEmpty: FetchResult<number[]> = { status: "stale", data: [], fetchedAt: "t" };
  const r = renderList(staleEmpty, "No alerts", "can't confirm alert state");
  assert.equal(r.kind, "unconfirmed");

  const okEmpty: FetchResult<number[]> = { status: "ok", data: [], fetchedAt: "t" };
  assert.equal(renderList(okEmpty, "No alerts", "can't confirm alert state").kind, "empty");

  const okItems: FetchResult<number[]> = { status: "ok", data: [1, 2], fetchedAt: "t" };
  const items = renderList(okItems, "No alerts", "can't confirm alert state");
  assert.equal(items.kind, "items");
  assert.equal(items.kind === "items" && items.items.length, 2);

  assert.equal(renderList({ status: "error", message: "x" } as FetchResult<number[]>, "e", "u").kind, "error");
});
