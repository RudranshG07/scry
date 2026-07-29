# Hero footage shortlist

Candidates for the landing hero and category sections. All free for commercial use
(Pexels and Mixkit licenses), no attribution required. Verified July 2026.

## Selection rules

Reject anything that fails these — they come straight from the stream acceptance gate
in the strategy document.

- **Real-time, never time-lapse.** Individual objects must be resolvable or the counting
  claim is not credible.
- **Locked-off camera.** No pan, zoom, or drone travel. A count line has to stay valid.
- **Elevated or top-down**, so objects separate instead of occluding.
- **Dark, or gradeable to dark.** Matches the palette and keeps white type readable.
- **Negative space** across one third of the frame for the headline.
- **No legible faces, plates, or brand walls.** The public feed is anonymized by policy.
- **Geography-neutral.** Avoid landmark cities — a recognizable casino strip actively
  fights the positioning.

## Hero candidates

| Clip | Specs | Notes |
| --- | --- | --- |
| [Aerial view of urban pedestrian crossing](https://www.pexels.com/video/aerial-view-of-urban-pedestrian-crossing-30935166/) | 4K, 24fps, static hover | Best overall match. Real-time, straight down, people and vehicles both countable. Daytime — needs grading down. |
| [Night intersection 3048225](https://www.pexels.com/video/aerial-footage-of-vehicular-traffic-of-a-busy-street-intersection-at-night-3048225/) | 2560×1440, 30fps | Real-time, night. Drone hover, slight drift. Night means white type reads with no scrim. |
| [Night intersection 3063475](https://www.pexels.com/video/from-above-footage-of-vehicular-traffic-on-a-busy-street-intersection-in-the-city-at-night-3063475/) | 2560×1440, 30fps | Same author and treatment as above. |
| [Night intersection 3058058](https://www.pexels.com/video/aerial-footage-of-vehicle-traffic-of-intersecting-city-streets-at-nighttime-3058058/) | 2560×1440, 30fps | Same series. |
| [Urban intersection traffic](https://www.pexels.com/video/aerial-view-of-urban-intersection-traffic-35239545/) | unverified | Worth checking. |
| [Night highway interchange](https://www.pexels.com/video/aerial-night-view-of-highway-interchange-33132637/) | unverified | Worth checking. |

## Category footage

**Operations** — [Packages moving on a conveyor belt](https://www.pexels.com/video/packages-moving-on-a-conveyor-belt-4156510/)
(1080p, 30fps, genuinely static). The most countable footage found anywhere: discrete
objects crossing a line at a steady rate. Best demo case for the line-crossing tracker
in `services/vision/`.

**Parking** — [Aerial footage of a parking lot](https://www.pexels.com/video/aerial-footage-of-a-parking-lot-5587732/) ·
[Crowded car parking lot](https://www.pexels.com/video/aerial-view-of-crowded-car-parking-lot-33610407/)

## Browse

[Pexels intersection](https://www.pexels.com/search/videos/intersection/) ·
[Pexels parking lot](https://www.pexels.com/search/videos/parking%20lot/) ·
[Pexels conveyor belt](https://www.pexels.com/search/videos/conveyor%20belt/) ·
[Mixkit overhead shots](https://mixkit.co/free-stock-video/overhead-shot/)

Mixkit's intersection clips are almost all labelled time-lapse or fast motion. Pexels
carries far more real-time material.

## Currently shipped

`public/landing/hero.mp4` — Mixkit "busy avenue in Las Vegas" (4251), Full HD, crossfade
looped. Placeholder only. Known problems: it is a time-lapse so vehicles are motion-blur
streaks, it is the Las Vegas Strip which reads as casino, and the frame is dense with
third-party signage. Replace before any public launch.

## The better option

Shoot 30 seconds on a locked-off phone overlooking a gate or road in Indore. Real-time,
own city, owned outright, no licensing question, and honest in a way no stock clip is.

## Live camera feeds (wired in)

Three Traffic markets now play real Caltrans District 7 feeds. Caltrans publishes open
HLS and — unlike most DOT networks — sends `Access-Control-Allow-Origin: *`, so these
play directly in the browser with no proxy.

| Market | Camera | Stream | Resolution |
| --- | --- | --- | --- |
| `long-beach-710` | CAM 262, N710 south of PCH | `wzmedia.dot.ca.gov/D7/CCTV-262.stream/playlist.m3u8` | 1280×720 |
| `los-angeles-405` | CAM 327, N405 at Lakewood Blvd | `wzmedia.dot.ca.gov/D7/CCTV-327.stream/playlist.m3u8` | 768×432 |
| `santa-monica-10` | CAM 101, E10 McClure Tunnel West | `wzmedia.dot.ca.gov/D7/CCTV-101.stream/playlist.m3u8` | 1280×720 |

Discovered through [OpenTrafficCamMap](https://github.com/AidanWelch/OpenTrafficCamMap),
a crowdsourced database with 2,919 HLS URLs across Caltrans (1,936), Wowza CDN (586),
DelDOT (295) and Georgia DOT. Verified end to end: master playlist → chunklist →
segment → h264 decode.

Roughly half the cameras sampled were offline at any moment, which is normal for these
networks and is the reason the uptime and invalidation rules exist.

`/api/stream` remains available for sources that do not send CORS headers. It is opt-in
per host through `NEXT_PUBLIC_SCRY_STREAM_PROXY_HOSTS` (client, decides what to route)
and `SCRY_STREAM_ALLOWED_HOSTS` (server, the SSRF allowlist). Both empty means direct
playback only.

## Delivery architecture

The browser must never depend on a third-party camera being reachable. Two layers
enforce that.

**Layer 1 — server-side resolution (active now).** `GET /api/streams/{marketId}` probes
the market's source pool server-side (playlist → chunklist → segment present), caches the
verdict for 20s, and returns only a source it has just confirmed is playable. If every
camera is down it returns an owned local clip instead. The client is never handed a dead
URL, so a camera going offline is an operational event rather than a broken screen.
Markets with no cameras at all resolve to the same local clip, which is why every room
plays video.

**Layer 2 — republish from our own origin (production).** `mediamtx` is in `compose.yaml`
with `infrastructure/mediamtx.yml`. It pulls each camera and republishes it as low-latency
HLS on a stable path, so the browser only ever requests
`<origin>/<marketId>/index.m3u8`. Source churn, reconnects and replacements happen behind
that path and never reach the client. Enable it by setting:

    SCRY_MEDIA_ORIGIN=http://127.0.0.1:8888

The resolver prefers that origin when it is set and healthy, and falls back to direct
source probing, then to the local clip. Migration is one environment variable.

The remaining single point of failure is that Scry does not own the cameras. Owning the
sensor — the stream acceptance gate in the strategy document — is the only complete fix,
and Layer 2 is the architecture that makes swapping to owned cameras a config change.

## Owned clip library (current default)

Free public cameras failed on three counts at once: they are dark for half of every day
(Caltrans cameras were sampled at 04:38 local), they drop without notice, and the ones
that survive are 640x480 night compression. Chasing better feeds was not converging.

The default surface is now footage Scry owns, served from Scry's origin:

| File | Source | Used by |
| --- | --- | --- |
| `public/streams/crossing.mp4` | Pexels 30935166, 4K static overhead crossing | Traffic, Queues |
| `public/streams/parking.mp4` | Pexels 5587732, UHD static overhead lot | Parking, Operations |

Both are downscaled to 1280 wide, crossfade-looped so the last frame is pixel-identical to
the first, and paired with a WebP poster. 1.2MB and 1.9MB. Daylight, locked-off, top-down,
with clearly separated subjects — which also makes them the right material to point the
line-crossing tracker at.

Resolution order in `/api/streams/{marketId}`:

1. `SCRY_MEDIA_ORIGIN` republisher, when configured and healthy
2. The market's owned clip
3. A verified-live public camera, only when `SCRY_PREFER_LIVE_CAMERAS=1`
4. The generic reference clip

Set `SCRY_PREFER_LIVE_CAMERAS=1` to put public cameras first; they still fall back to the
owned clip the moment one fails a probe. The stage badge reads LIVE only when the resolved
source is genuinely a live camera, and the strip under the video always names what is
playing.

## Follow the sun (current behaviour)

The earlier judgement that public cameras "look terrible" was wrong. They were sampled at
04:38 Pacific. The same cameras at 07:11 Pacific are clear, well framed and countable.
Quality was never the camera — it was the hour.

`/api/streams/{marketId}` now resolves in this order:

1. `SCRY_MEDIA_ORIGIN` republisher, when configured and healthy
2. A camera that is **verified live and currently in daylight** at its own timezone
   (07:00–19:00 local), pool ordered by how well the scene frames a count line
3. A camera that is verified live but dark
4. The owned clip for that market
5. The generic reference clip

Every source carries a `timeZone`, so extending the pool across regions keeps a daylight
camera available around the clock. The current pool is Caltrans only
(`America/Los_Angeles`), which covers roughly 14:00–02:00 UTC. Adding European and Asian
sources would close the remaining window.

Live is the default because the product's claim is verifiable observation of the real
world. Recorded footage is the floor that keeps the screen working, never the thing being
presented as live: the stage badge reads LIVE only when the resolved source genuinely is,
and the strip under the video always names what is playing.
