import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAccess } from "../services/access/policy.ts";

const policy = {
  monetaryEnabled: true,
  monetaryJurisdictions: ["US"],
  blockedForecastJurisdictions: ["KP"],
  requireIdentityVerification: true,
  requireSanctionsScreening: true,
};

function request(updates = {}) {
  return {
    requestedMode: "monetary",
    ageThresholdMet: true,
    jurisdictionCode: "US",
    jurisdictionSource: "verified",
    identityVerified: true,
    sanctionsCleared: true,
    coolOffUntil: null,
    evaluatedAt: "2026-07-21T10:00:00.000Z",
    ...updates,
  };
}

test("verified allowlisted users can receive monetary access", () => {
  assert.deepEqual(evaluateAccess(request(), policy), {
    mode: "monetary",
    forecastAllowed: true,
    monetaryAllowed: true,
    reasons: ["eligible"],
    evaluatedAt: "2026-07-21T10:00:00.000Z",
  });
});

test("self-declared location never authorizes monetary access", () => {
  const decision = evaluateAccess(request({ jurisdictionSource: "self_declared" }), policy);
  assert.equal(decision.mode, "forecast_only");
  assert.deepEqual(decision.reasons, ["jurisdiction_unverified"]);
});

test("cool-off and incomplete verification fail closed to forecast mode", () => {
  const decision = evaluateAccess(request({
    identityVerified: false,
    sanctionsCleared: false,
    coolOffUntil: "2026-07-22T10:00:00.000Z",
  }), policy);
  assert.equal(decision.mode, "forecast_only");
  assert.deepEqual(decision.reasons, ["identity_verification_required", "sanctions_screening_required", "cool_off_active"]);
});

test("age failure and forecast-blocked jurisdictions deny access", () => {
  assert.equal(evaluateAccess(request({ ageThresholdMet: false }), policy).mode, "denied");
  assert.equal(evaluateAccess(request({ requestedMode: "forecast", jurisdictionCode: "KP" }), policy).mode, "denied");
});

test("disabled monetary access and non-allowlisted regions remain forecast-only", () => {
  assert.deepEqual(
    evaluateAccess(request({ jurisdictionCode: "GB" }), { ...policy, monetaryEnabled: false }).reasons,
    ["monetary_disabled", "monetary_jurisdiction_blocked"],
  );
});

test("invalid policy overlap and unzoned timestamps are rejected", () => {
  assert.throws(
    () => evaluateAccess(request(), { ...policy, blockedForecastJurisdictions: ["US"] }),
    TypeError,
  );
  assert.throws(() => evaluateAccess(request({ evaluatedAt: "2026-07-21T10:00:00" }), policy), TypeError);
});
