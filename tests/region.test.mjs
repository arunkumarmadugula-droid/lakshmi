import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyVault, normalizeVault } from "../src/data/defaults.js";
import { applyFormattingPreferences, money } from "../src/lib/format.js";

test("country setup chooses one locked currency and normalizes restored profiles", () => {
  const india = createEmptyVault("India household", "IN");
  assert.equal(india.settings.country, "IN");
  assert.equal(india.profile.currency, "INR");
  assert.equal(india.profile.locale, "en-IN");

  const restored = normalizeVault({ profile: { currency: "INR" }, settings: {} }, "Restored");
  assert.equal(restored.settings.country, "IN");
  assert.equal(restored.profile.currency, "INR");
});

test("money formatting follows the open profile", () => {
  applyFormattingPreferences({ currency: "INR", locale: "en-IN" });
  assert.match(money(1234, 0), /₹/u);
  applyFormattingPreferences({ currency: "CAD", locale: "en-CA" });
  assert.match(money(1234, 0), /\$/);
});
