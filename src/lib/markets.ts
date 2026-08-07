import type { Category } from "./domain.ts";

export type { Category, Market, MarketOutcome, MarketStatus } from "./domain.ts";

export const categories: Array<"All" | Category> = [
  "All",
  "Traffic",
  "Parking",
  "Queues",
  "Operations",
];

export type MarketSeed = {
  id: string;
  streamId: string;
  category: Category;
  location: string;
  city: string;
  question: string;
  unit: string;
  threshold: number;
  cycleMinutes: number;
  offsetMinutes: number;
  openMinutes: number;
  observeMinutes: number;
  baseline: number;
  rateBias: number;
  prior: number;
  poolSeed: number;
  observers: number;
  streamSources?: Array<{ url: string; name: string; timeZone: string }>;
  clip?: { url: string; poster: string; name: string };
  archived?: boolean;
  invalid?: boolean;
  outcomes: [{ id: string; label: string }, { id: string; label: string }];
};

export const marketSeeds: MarketSeed[] = [
  {
    id: "long-beach-710",
    streamId: "stream-long-beach-710",
    category: "Traffic",
    location: "I-5 at 28th Street",
    city: "San Diego",
    question: "Will more than 180 vehicles cross the count line during the observation window?",
    unit: "vehicles",
    threshold: 180,
    cycleMinutes: 60,
    offsetMinutes: 0,
    openMinutes: 8,
    observeMinutes: 15,
    baseline: 10.9,
    rateBias: 1.1,
    prior: 62,
    poolSeed: 8420,
    observers: 3,
    clip: { url: "/streams/crossing.mp4", poster: "/streams/crossing.webp", name: "Reference footage · signalled crossing" },
    streamSources: [
      { url: "https://wzmedia.dot.ca.gov/D11/C023_SB_5_JNO_28th_St.stream/playlist.m3u8", name: "C23 · SB I-5 at 28th St, San Diego", timeZone: "America/Los_Angeles" },
      { url: "https://wzmedia.dot.ca.gov/D11/C006_EB_8_JEO_Taylor.stream/playlist.m3u8", name: "C6 · EB I-8 at Taylor St, San Diego", timeZone: "America/Los_Angeles" },
      { url: "https://wzmedia.dot.ca.gov/D7/CCTV-262.stream/playlist.m3u8", name: "CAM 262 · N710 s/o PCH, Long Beach", timeZone: "America/Los_Angeles" },
    ],
    outcomes: [
      { id: "yes", label: "Yes, above 180" },
      { id: "no", label: "No, 180 or below" },
    ],
  },
  {
    id: "pune-ev-lot",
    streamId: "stream-pune-ev-lot",
    category: "Parking",
    location: "Riverside EV Lot",
    city: "Pune",
    question: "Will more than 68 vehicles claim a charging bay this window?",
    unit: "arrivals",
    threshold: 68,
    cycleMinutes: 60,
    offsetMinutes: 14,
    openMinutes: 10,
    observeMinutes: 20,
    baseline: 3.47,
    rateBias: 0.98,
    prior: 48,
    poolSeed: 5135,
    observers: 3,
    clip: { url: "/streams/parking.mp4", poster: "/streams/parking.webp", name: "Reference footage · surface lot" },
    outcomes: [
      { id: "yes", label: "Yes, above 68" },
      { id: "no", label: "No, 68 or below" },
    ],
  },
  {
    id: "bengaluru-food-hall",
    streamId: "stream-bengaluru-food-hall",
    category: "Queues",
    location: "Orion Food Hall",
    city: "Bengaluru",
    question: "Will the service queue take more than 25 people this window?",
    unit: "people",
    threshold: 25,
    cycleMinutes: 45,
    offsetMinutes: 7,
    openMinutes: 6,
    observeMinutes: 12,
    baseline: 1.77,
    rateBias: 1.18,
    prior: 73,
    poolSeed: 12680,
    observers: 3,
    clip: { url: "/streams/crossing.mp4", poster: "/streams/crossing.webp", name: "Reference footage · signalled crossing" },
    outcomes: [
      { id: "yes", label: "Yes, above 25" },
      { id: "no", label: "No, 25 or below" },
    ],
  },
  {
    id: "mumbai-sort-lane",
    streamId: "stream-mumbai-sort-lane",
    category: "Operations",
    location: "Sort Lane 04",
    city: "Navi Mumbai",
    question: "Will throughput stay above 420 packages this window?",
    unit: "packages",
    threshold: 420,
    cycleMinutes: 90,
    offsetMinutes: 31,
    openMinutes: 12,
    observeMinutes: 30,
    baseline: 13.7,
    rateBias: 1.02,
    prior: 57,
    poolSeed: 2400,
    observers: 3,
    clip: { url: "/streams/parking.mp4", poster: "/streams/parking.webp", name: "Reference footage · surface lot" },
    outcomes: [
      { id: "yes", label: "Yes, 420 or above" },
      { id: "no", label: "No, below 420" },
    ],
  },
  {
    id: "los-angeles-405",
    streamId: "stream-los-angeles-405",
    category: "Traffic",
    location: "I-8 at Taylor Street",
    city: "San Diego",
    question: "Will eastbound crossings exceed 240 vehicles this window?",
    unit: "vehicles",
    threshold: 240,
    cycleMinutes: 60,
    offsetMinutes: 38,
    openMinutes: 9,
    observeMinutes: 16,
    baseline: 14.3,
    rateBias: 1.05,
    prior: 68,
    poolSeed: 9340,
    observers: 3,
    clip: { url: "/streams/crossing.mp4", poster: "/streams/crossing.webp", name: "Reference footage · signalled crossing" },
    streamSources: [
      { url: "https://wzmedia.dot.ca.gov/D11/C006_EB_8_JEO_Taylor.stream/playlist.m3u8", name: "C6 · EB I-8 at Taylor St, San Diego", timeZone: "America/Los_Angeles" },
      { url: "https://wzmedia.dot.ca.gov/D11/C023_SB_5_JNO_28th_St.stream/playlist.m3u8", name: "C23 · SB I-5 at 28th St, San Diego", timeZone: "America/Los_Angeles" },
      { url: "https://wzmedia.dot.ca.gov/D11/C057_WB_8_JEO_Rte_15.stream/playlist.m3u8", name: "C57 · WB I-8 at I-15, San Diego", timeZone: "America/Los_Angeles" },
    ],
    outcomes: [
      { id: "yes", label: "Yes, above 240" },
      { id: "no", label: "No, 240 or below" },
    ],
  },
  {
    id: "hyderabad-west-lot",
    streamId: "stream-hyderabad-west-lot",
    category: "Parking",
    location: "West Campus Lot",
    city: "Hyderabad",
    question: "Will more than 90 vehicles enter the west lot this window?",
    unit: "arrivals",
    threshold: 90,
    cycleMinutes: 75,
    offsetMinutes: 22,
    openMinutes: 10,
    observeMinutes: 22,
    baseline: 4.35,
    rateBias: 0.94,
    prior: 52,
    poolSeed: 4120,
    observers: 3,
    clip: { url: "/streams/parking.mp4", poster: "/streams/parking.webp", name: "Reference footage · surface lot" },
    outcomes: [
      { id: "yes", label: "Yes, above 90" },
      { id: "no", label: "No, 90 or below" },
    ],
  },
  {
    id: "chennai-gate-c",
    streamId: "stream-chennai-gate-c",
    category: "Queues",
    location: "Ticketing Gate C",
    city: "Chennai",
    question: "Will more than 34 people clear ticketing this window?",
    unit: "people",
    threshold: 34,
    cycleMinutes: 50,
    offsetMinutes: 44,
    openMinutes: 7,
    observeMinutes: 14,
    baseline: 2.17,
    rateBias: 1.12,
    prior: 44,
    poolSeed: 6210,
    observers: 3,
    clip: { url: "/streams/crossing.mp4", poster: "/streams/crossing.webp", name: "Reference footage · signalled crossing" },
    outcomes: [
      { id: "yes", label: "Yes, above 34" },
      { id: "no", label: "No, 34 or below" },
    ],
  },
  {
    id: "ahmedabad-dock",
    streamId: "stream-ahmedabad-dock",
    category: "Operations",
    location: "Dock Bay 07",
    city: "Ahmedabad",
    question: "Will more than 96 pallets clear dock bay 07 this window?",
    unit: "pallets",
    threshold: 96,
    cycleMinutes: 70,
    offsetMinutes: 12,
    openMinutes: 11,
    observeMinutes: 24,
    baseline: 3.77,
    rateBias: 1.06,
    prior: 61,
    poolSeed: 3480,
    observers: 3,
    clip: { url: "/streams/parking.mp4", poster: "/streams/parking.webp", name: "Reference footage · surface lot" },
    outcomes: [
      { id: "yes", label: "Yes, above 96" },
      { id: "no", label: "No, 96 or below" },
    ],
  },
  {
    id: "santa-monica-10",
    streamId: "stream-santa-monica-10",
    category: "Traffic",
    location: "I-8 at Interstate 15",
    city: "San Diego",
    question: "Did westbound crossings exceed 300 vehicles?",
    unit: "vehicles",
    threshold: 300,
    cycleMinutes: 60,
    offsetMinutes: 5,
    openMinutes: 9,
    observeMinutes: 18,
    baseline: 16.0,
    rateBias: 1.04,
    prior: 66,
    poolSeed: 7480,
    observers: 3,
    clip: { url: "/streams/crossing.mp4", poster: "/streams/crossing.webp", name: "Reference footage · signalled crossing" },
    streamSources: [
      { url: "https://wzmedia.dot.ca.gov/D11/C057_WB_8_JEO_Rte_15.stream/playlist.m3u8", name: "C57 · WB I-8 at I-15, San Diego", timeZone: "America/Los_Angeles" },
      { url: "https://wzmedia.dot.ca.gov/D7/CCTV-262.stream/playlist.m3u8", name: "CAM 262 · N710 s/o PCH, Long Beach", timeZone: "America/Los_Angeles" },
      { url: "https://wzmedia.dot.ca.gov/D11/C023_SB_5_JNO_28th_St.stream/playlist.m3u8", name: "C23 · SB I-5 at 28th St, San Diego", timeZone: "America/Los_Angeles" },
    ],
    archived: true,
    outcomes: [
      { id: "yes", label: "Yes, above 300" },
      { id: "no", label: "No, 300 or below" },
    ],
  },
  {
    id: "kolkata-metro-gate",
    streamId: "stream-kolkata-metro-gate",
    category: "Queues",
    location: "Metro Gate B",
    city: "Kolkata",
    question: "Did gate B clear more than 140 passengers?",
    unit: "passengers",
    threshold: 140,
    cycleMinutes: 60,
    offsetMinutes: 27,
    openMinutes: 8,
    observeMinutes: 20,
    baseline: 7.22,
    rateBias: 0.97,
    prior: 54,
    poolSeed: 4120,
    observers: 1,
    clip: { url: "/streams/crossing.mp4", poster: "/streams/crossing.webp", name: "Reference footage · signalled crossing" },
    archived: true,
    invalid: true,
    outcomes: [
      { id: "yes", label: "Yes, above 140" },
      { id: "no", label: "No, 140 or below" },
    ],
  },
];

export const marketDirectory = new Map(
  marketSeeds.map((seed) => [
    seed.id,
    {
      id: seed.id,
      streamId: seed.streamId,
      category: seed.category,
      city: seed.city,
      location: seed.location,
      question: seed.question,
      unit: seed.unit,
      threshold: seed.threshold,
      streamSources: seed.streamSources,
      clip: seed.clip,
    },
  ]),
);

export function marketStreamSources(id: string) {
  return marketDirectory.get(id)?.streamSources ?? [];
}

export function marketLabel(id: string) {
  const entry = marketDirectory.get(id);
  return entry ? `${entry.city} · ${entry.location}` : id;
}

export function marketQuestion(id: string) {
  return marketDirectory.get(id)?.question ?? "Market";
}

export function marketUnit(id: string) {
  return marketDirectory.get(id)?.unit ?? "events";
}

export function marketCategory(id: string) {
  return marketDirectory.get(id)?.category;
}

export function outcomeLabel(marketId: string, outcomeId: string) {
  const seed = marketSeeds.find((item) => item.id === marketId);
  return seed?.outcomes.find((outcome) => outcome.id === outcomeId)?.label ?? outcomeId;
}

export function marketClip(id: string) {
  return marketDirectory.get(id)?.clip;
}

// Cameras belong to a stream, not to a market: a stream outlives the markets
// scheduled on it. Keyed by stream id so the API's streamId resolves directly.
//
// Caltrans was the whole pool and is gone from it. The manifests still parse, so
// every probe called them healthy, while segments arrived at 0.6 Mbit/s against
// a 2.1 Mbit/s stream — the player buffered forever and showed nothing. These
// are CDN-backed and carry six bitrates, so a thin connection drops to 144p
// instead of stalling.
const YOUTUBE = "https://www.youtube.com/watch?v=";

export const streamSourcePool: Record<string, Array<{ url: string; name: string; timeZone: string }>> = {
  "stream-london-abbey": [
    { url: `${YOUTUBE}M3EYAY2MftI`, name: "Abbey Road Crossing, London", timeZone: "Europe/London" },
  ],
  "stream-sd-5-28th": [
    { url: `${YOUTUBE}9KinvEHYcZc`, name: "Calea Victoriei, Bucharest", timeZone: "Europe/Bucharest" },
    { url: `${YOUTUBE}M3EYAY2MftI`, name: "Abbey Road Crossing, London", timeZone: "Europe/London" },
  ],
  "stream-sd-8-taylor": [
    { url: `${YOUTUBE}2juLrCH5w9U`, name: "Ohio 741 at 73", timeZone: "America/New_York" },
    { url: `${YOUTUBE}9KinvEHYcZc`, name: "Calea Victoriei, Bucharest", timeZone: "Europe/Bucharest" },
  ],
  "stream-sd-8-15": [
    { url: `${YOUTUBE}Evt_Jy3vh9I`, name: "Cedar Corner Roundabout", timeZone: "America/New_York" },
    { url: `${YOUTUBE}2juLrCH5w9U`, name: "Ohio 741 at 73", timeZone: "America/New_York" },
  ],
};

export function sourcesFor(id: string) {
  return streamSourcePool[id] ?? streamSourcePool[streamKeyFor(id) ?? ""] ?? marketDirectory.get(id)?.streamSources ?? [];
}

/**
 * The stream a market observes. Relay paths are keyed by stream because one
 * camera outlives many markets on it, while ids arriving here are market ids
 * like `stream-sd-8-15-1785476115`. Asking the relay for a market id gets a
 * miss and quietly falls back to the third-party camera the relay exists to
 * avoid.
 */
export function streamKeyFor(id: string): string | null {
  if (streamSourcePool[id]) return id;
  const keys = Object.keys(streamSourcePool).filter((key) => id.startsWith(key));
  if (keys.length === 0) return null;
  // Longest match wins, so a stream id that prefixes another cannot capture it.
  return keys.reduce((longest, key) => (key.length > longest.length ? key : longest));
}

export function clipFor(id: string) {
  if (marketDirectory.has(id)) return marketDirectory.get(id)?.clip;
  return { url: "/streams/crossing.mp4", poster: "/streams/crossing.webp", name: "Reference footage · signalled crossing" };
}
