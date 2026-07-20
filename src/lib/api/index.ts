import { HttpScryApi } from "@/lib/api/http";
import { MockScryApi } from "@/lib/api/mock";

const apiUrl = process.env.NEXT_PUBLIC_SCRY_API_URL;
const websocketUrl = process.env.NEXT_PUBLIC_SCRY_WS_URL;

export const scryApi = apiUrl && websocketUrl
  ? new HttpScryApi(apiUrl.replace(/\/$/, ""), websocketUrl.replace(/\/$/, ""))
  : new MockScryApi();

export type { ScryApi } from "@/lib/api/contract";
