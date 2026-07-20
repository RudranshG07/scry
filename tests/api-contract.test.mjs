import assert from "node:assert/strict";
import test from "node:test";
import { ScryApiError } from "../src/lib/api/contract.ts";

test("API errors preserve status and a stable name", () => {
  const error = new ScryApiError("Request failed.", 429);
  assert.equal(error.message, "Request failed.");
  assert.equal(error.status, 429);
  assert.equal(error.name, "ScryApiError");

});


