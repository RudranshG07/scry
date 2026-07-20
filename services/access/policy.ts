export type AccessMode = "denied" | "forecast_only" | "monetary";

export type AccessReason =
  | "eligible"
  | "age_unverified"
  | "forecast_jurisdiction_blocked"
  | "jurisdiction_unverified"
  | "monetary_jurisdiction_blocked"
  | "identity_verification_required"
  | "sanctions_screening_required"
  | "cool_off_active"
  | "monetary_disabled";

export type AccessRequest = {
  requestedMode: "forecast" | "monetary";
  ageThresholdMet: boolean;
  jurisdictionCode: string | null;
  jurisdictionSource: "verified" | "self_declared" | "unknown";
  identityVerified: boolean;
  sanctionsCleared: boolean;
  coolOffUntil: string | null;
  evaluatedAt: string;
};

export type AccessPolicy = {
  monetaryEnabled: boolean;
  monetaryJurisdictions: string[];
  blockedForecastJurisdictions: string[];
  requireIdentityVerification: boolean;
  requireSanctionsScreening: boolean;
};

export type AccessDecision = {
  mode: AccessMode;
  forecastAllowed: boolean;
  monetaryAllowed: boolean;
  reasons: AccessReason[];
  evaluatedAt: string;
};

function jurisdiction(value: string) {
  if (!/^[A-Z]{2}$/.test(value)) throw new TypeError("Jurisdiction codes must use uppercase ISO alpha-2 format.");
  return value;
}

function time(value: string) {
  if (!/(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new TypeError("Access timestamps must include a timezone.");
  }
  return Date.parse(value);
}

function validate(request: AccessRequest, policy: AccessPolicy) {
  const monetary = new Set(policy.monetaryJurisdictions.map(jurisdiction));
  const blocked = new Set(policy.blockedForecastJurisdictions.map(jurisdiction));
  if ([...monetary].some((code) => blocked.has(code))) {
    throw new TypeError("A jurisdiction cannot be both monetary-enabled and forecast-blocked.");
  }
  if (request.jurisdictionCode) jurisdiction(request.jurisdictionCode);
  if (!request.jurisdictionCode && request.jurisdictionSource !== "unknown") {
    throw new TypeError("Missing jurisdiction codes must use the unknown source.");
  }
  time(request.evaluatedAt);
  if (request.coolOffUntil) time(request.coolOffUntil);
  return { monetary, blocked };
}

export function evaluateAccess(request: AccessRequest, policy: AccessPolicy): AccessDecision {
  const { monetary, blocked } = validate(request, policy);
  const evaluatedAt = time(request.evaluatedAt);
  const code = request.jurisdictionCode;

  if (!request.ageThresholdMet) {
    return { mode: "denied", forecastAllowed: false, monetaryAllowed: false, reasons: ["age_unverified"], evaluatedAt: request.evaluatedAt };
  }
  if (code && blocked.has(code)) {
    return { mode: "denied", forecastAllowed: false, monetaryAllowed: false, reasons: ["forecast_jurisdiction_blocked"], evaluatedAt: request.evaluatedAt };
  }
  if (request.requestedMode === "forecast") {
    return { mode: "forecast_only", forecastAllowed: true, monetaryAllowed: false, reasons: ["eligible"], evaluatedAt: request.evaluatedAt };
  }

  const reasons: AccessReason[] = [];
  if (!policy.monetaryEnabled) reasons.push("monetary_disabled");
  if (!code || request.jurisdictionSource !== "verified") reasons.push("jurisdiction_unverified");
  else if (!monetary.has(code)) reasons.push("monetary_jurisdiction_blocked");
  if (policy.requireIdentityVerification && !request.identityVerified) reasons.push("identity_verification_required");
  if (policy.requireSanctionsScreening && !request.sanctionsCleared) reasons.push("sanctions_screening_required");
  if (request.coolOffUntil && time(request.coolOffUntil) > evaluatedAt) reasons.push("cool_off_active");

  if (reasons.length) {
    return { mode: "forecast_only", forecastAllowed: true, monetaryAllowed: false, reasons, evaluatedAt: request.evaluatedAt };
  }
  return { mode: "monetary", forecastAllowed: true, monetaryAllowed: true, reasons: ["eligible"], evaluatedAt: request.evaluatedAt };
}
