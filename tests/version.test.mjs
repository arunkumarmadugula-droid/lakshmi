import assert from "node:assert/strict";
import test from "node:test";
import { APP_VERSION, compareVersions } from "../src/lib/version.js";

test("published version comparisons distinguish newer, current, and older builds", () => {
  assert.equal(APP_VERSION, "9.0.0");
  assert.equal(compareVersions("9.0.1", APP_VERSION), 1);
  assert.equal(compareVersions("9.0.0", APP_VERSION), 0);
  assert.equal(compareVersions("8.6.0", APP_VERSION), -1);
});
