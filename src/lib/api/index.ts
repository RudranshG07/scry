import { HttpScryApi } from "@/lib/api/http";

const apiUrl = process.env.NEXT_PUBLIC_SCRY_API_URL;
const websocketUrl = process.env.NEXT_PUBLIC_SCRY_WS_URL;

/**
 * Which backend the app talks to. There is only one, and it is the real one.
 * A simulator used to sit behind this and served invented markets that looked
 * identical to observed ones on screen, with nothing in the console to say so.
 */
function selectApi() {
  if (apiUrl && websocketUrl) {
    return new HttpScryApi(apiUrl.replace(/\/$/, ""), websocketUrl.replace(/\/$/, ""));
  }
  throw new Error(
    "Scry has no API to talk to. Set NEXT_PUBLIC_SCRY_API_URL and NEXT_PUBLIC_SCRY_WS_URL.",
  );
}

export const scryApi = selectApi();

export type { ScryApi } from "@/lib/api/contract";
