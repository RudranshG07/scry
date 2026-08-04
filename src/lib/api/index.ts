import { HttpScryApi } from "@/lib/api/http";
import { MockScryApi } from "@/lib/api/mock";

const apiUrl = process.env.NEXT_PUBLIC_SCRY_API_URL;
const websocketUrl = process.env.NEXT_PUBLIC_SCRY_WS_URL;
const mockRequested = process.env.NEXT_PUBLIC_SCRY_USE_MOCK === "1";

/**
 * Which backend the app talks to. The simulator must be asked for by name: as a
 * fallback it served invented markets that look identical to real ones on screen,
 * with nothing in the console to say so.
 */
function selectApi() {
  if (mockRequested) return new MockScryApi();
  if (apiUrl && websocketUrl) {
    return new HttpScryApi(apiUrl.replace(/\/$/, ""), websocketUrl.replace(/\/$/, ""));
  }
  throw new Error(
    "Scry has no API to talk to. Set NEXT_PUBLIC_SCRY_API_URL and NEXT_PUBLIC_SCRY_WS_URL, " +
      "or NEXT_PUBLIC_SCRY_USE_MOCK=1 to run against the simulator deliberately.",
  );
}

export const scryApi = selectApi();

/** True when nothing on screen came from a real observation. */
export const isSimulated = mockRequested;

export type { ScryApi } from "@/lib/api/contract";
