"""Decides whether a camera can be observed from here.

Frames have to arrive faster than they are produced. A source with 15% headroom
looks healthy until it is not, and nothing downstream can tell that from a bad
detector, so a candidate is measured before it is trusted.
"""

from __future__ import annotations

from .capture import open_capture

import argparse
import json
import os
import re
import subprocess
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request

# Matches the qualification gate: an observer needs footage faster than it
# plays, not three times faster.
MIN_REALTIME_FACTOR = 1.5
MIN_FPS = 10.0


def _credentials() -> list[str]:
    """How yt-dlp should identify itself, if it has been told.

    YouTube starts answering "Sign in to confirm you are not a bot" once it has
    seen enough automated resolutions from one address, and then every stream
    fails to resolve at once with nothing wrong with any of them. Cookies from a
    signed-in browser lift it.

    SCRY_YTDLP_COOKIES takes either a browser name (chrome, firefox, safari) or
    a path to a cookies.txt.
    """
    setting = os.environ.get("SCRY_YTDLP_COOKIES", "").strip()
    if not setting:
        return []
    if os.path.exists(setting):
        return ["--cookies", setting]
    return ["--cookies-from-browser", setting]


def _ytdlp(args: list[str]) -> str | None:
    try:
        out = subprocess.run(["yt-dlp", "--no-update", *_credentials(), *args],
                             capture_output=True, text=True, timeout=90)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if out.returncode != 0:
        # Worth saying out loud: this failure looks identical to a dead camera
        # from the outside, and it suspends every stream at once.
        if "not a bot" in (out.stderr or ""):
            print("yt-dlp is being asked to sign in; set SCRY_YTDLP_COOKIES",
                  file=sys.stderr, flush=True)
        return None
    return out.stdout


# What a counting pass wants out of the ladder.
#
# Matched to the detector's input rather than to the best rendition on offer.
# YOLO runs at imgsz 640 and letterboxes whatever it is given, so a 720p frame
# is scaled down before it is ever looked at: those bytes buy nothing and cost
# throughput. Shibuya at 720 measured between 0.8 and 2.2 of realtime on this
# connection and was suspended for it; at 480 it measured 4.0.
COUNTING_HEIGHT = 640


def media_playlist(master: str, height: int = COUNTING_HEIGHT) -> str | None:
    """One rendition out of a master playlist.

    OpenCV cannot open a master: ffmpeg reads the variant list, finds no media,
    and returns nothing. The browser wants the master so it can change bitrate
    mid-stream; an observer wants one rendition and to stay on it.
    """
    try:
        body = _fetch(master)
    except Exception:
        return None
    if "#EXT-X-STREAM-INF" not in body:
        return master

    lines = [line.strip() for line in body.splitlines()]
    best: tuple[int, str] | None = None
    for index, line in enumerate(lines):
        if not line.startswith("#EXT-X-STREAM-INF") or index + 1 >= len(lines):
            continue
        target = lines[index + 1]
        if not target or target.startswith("#"):
            continue
        found = re.search(r"RESOLUTION=\d+x(\d+)", line)
        tall = int(found.group(1)) if found else 0
        if tall > height:
            continue
        if best is None or tall > best[0]:
            best = (tall, urllib.parse.urljoin(master, target))

    if best:
        return best[1]
    # Every rendition is taller than asked for, so take the smallest of them.
    for index, line in enumerate(lines):
        if line.startswith("#EXT-X-STREAM-INF") and index + 1 < len(lines):
            return urllib.parse.urljoin(master, lines[index + 1])
    return None


def resolve(source: str) -> str | None:
    """Watch page to a playlist an observer can open.

    The variant manifest is asked for by name rather than taking whatever `-g`
    ranks best. On some streams that is a progressive mp4, and everything
    downstream reads the result as a playlist: one camera was suspended for
    "URL can't contain control characters" because its mp4 header was being
    parsed as a list of segments.
    """
    if source.startswith("http") and ".m3u8" in source:
        return media_playlist(source) or source

    probed = _ytdlp(["-J", "--no-warnings", "--no-playlist", source])
    if probed:
        try:
            payload = json.loads(probed)
            master = payload.get("manifest_url") or next(
                (f["manifest_url"] for f in payload.get("formats") or [] if f.get("manifest_url")),
                None)
            if master:
                return media_playlist(master) or master
        except (json.JSONDecodeError, KeyError):
            pass

    direct = _ytdlp(["-g", "-f", "best[protocol^=m3u8][height<=720]/best[protocol^=m3u8]", source])
    for line in (direct or "").splitlines():
        if line.startswith("http"):
            return line
    return None


# A CDN that has seen a lot of us lately resets connections rather than
# refusing them, and one reset used to condemn the camera for two hours.
SEGMENT_SAMPLE = 6
FETCH_ATTEMPTS = 3
FETCH_BACKOFF = 2.0

BROWSER_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
              "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36")


def _get(url: str, timeout: float = 20.0) -> bytes:
    """One request, retried through the resets these CDNs hand out."""
    import time

    last: Exception | None = None
    for attempt in range(FETCH_ATTEMPTS):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": BROWSER_UA})
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read()
        except (ConnectionResetError, TimeoutError, urllib.error.URLError, OSError) as error:
            last = error
            if attempt + 1 < FETCH_ATTEMPTS:
                time.sleep(FETCH_BACKOFF * (attempt + 1))
    raise last if last else OSError("fetch failed")


def _fetch(url: str) -> str:
    return _get(url).decode("utf-8", "replace")


def throughput(playlist: str) -> dict:
    """How much faster than real time the segments arrive."""
    import time

    try:
        body = _fetch(playlist)
    except Exception as error:
        return {"ok": False, "reason": f"playlist unreachable: {error}"}

    lines = [line.strip() for line in body.splitlines()]
    entries = [line for line in lines if line and not line.startswith("#")]

    # A master playlist lists renditions, not segments, so it carries no EXTINF
    # and measuring it directly reports zero seconds of video and suspends a
    # perfectly good camera. Descend to the lowest rendition, which is the one a
    # thin connection would end up on anyway.
    #
    # Decided by what the body says, not by what the url looks like. YouTube's
    # segments are served from paths containing "/index.m3u8/", so matching on
    # the extension fetched a segment, read the mp4 header as a list of
    # segments, and reported the camera dead over a url full of nul bytes.
    if "#EXT-X-STREAM-INF" in body and entries:
        playlist = urllib.parse.urljoin(playlist, entries[-1])
        try:
            body = _fetch(playlist)
        except Exception as error:
            return {"ok": False, "reason": f"variant unreachable: {error}"}
        lines = [line.strip() for line in body.splitlines()]

    seconds = sum(float(line.split(":", 1)[1].rstrip(",")) for line in lines
                  if line.startswith("#EXTINF:"))
    segments = [line for line in lines if line and not line.startswith("#")]
    if not segments:
        return {"ok": False, "reason": "playlist lists no segments"}

    base = playlist.rsplit("/", 1)[0]
    downloaded = 0.0
    total_bytes = 0
    # Six rather than three. The same stream measured 0.8, 1.3, 1.4, 2.2 and 4.0
    # across consecutive three-segment samples, which is not a camera changing —
    # it is too small a sample of a network that varies. A verdict that suspends
    # a stream for two hours should not turn on that much noise.
    for name in segments[:SEGMENT_SAMPLE]:
        url = name if name.startswith("http") else f"{base}/{name}"
        started = time.monotonic()
        try:
            total_bytes += len(_get(url, timeout=30))
        except Exception as error:
            return {"ok": False, "reason": f"segment failed: {error}"}
        downloaded += time.monotonic() - started

    covered = seconds * (min(SEGMENT_SAMPLE, len(segments)) / len(segments))
    return {
        "ok": True,
        "seconds_of_video": round(covered, 1),
        "seconds_to_fetch": round(downloaded, 2),
        "realtime_factor": round(covered / downloaded, 1) if downloaded else 0.0,
        "megabits": round(total_bytes * 8 / 1_000_000, 1),
    }


def watch(playlist: str, seconds: float, stream: str = "") -> dict:
    """Run both detector profiles and report what each actually received."""
    from .observer import observe
    from .scenes import scene_for

    scene = scene_for(stream)
    out: dict[str, dict] = {}

    def go(key, role):
        out[key] = observe(playlist, scene, seconds=seconds, role=role)

    threads = [threading.Thread(target=go, args=("primary", "primary_vision")),
               threading.Thread(target=go, args=("verify", "verification"))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    p, v = out.get("primary", {}), out.get("verify", {})
    if not (p.get("ok") and v.get("ok")):
        return {"ok": False, "reason": "no frames"}

    return {
        "ok": True,
        "fps": round(p["frames"] / max(p["elapsed"], 1), 1),
        "uptime": round(min(p["uptime"], v["uptime"]), 4),
        "visibility": round(min(p["visibility"], v["visibility"]), 3),
        "frames": p["frames"],
        "frame_gap": abs(p["frames"] - v["frames"]),
        "counts": [p["count"], v["count"]],
    }


def busiest_band(playlist: str, scene, seconds: float = 60, bands: int = 12) -> dict:
    """Where subjects actually move, as fractions of frame height.

    A line placed by eye sits wherever the frame looks interesting. At Abbey Road
    the default crossed empty foreground road while every pedestrian used a
    crossing higher up, so a working detector counted almost nothing.
    """
    import cv2

    from .detector import PEOPLE, VEHICLES, _load, MODELS

    yolo = _load(MODELS["primary_vision"].weights)
    classes = list(PEOPLE if scene.unit == "people" else VEHICLES)

    capture = open_capture(playlist)
    if not capture.isOpened():
        return {}

    import time

    tally = [0] * bands
    started = time.monotonic()
    while time.monotonic() - started < seconds:
        ok, frame = capture.read()
        if not ok:
            continue
        # Native frame, letterboxed by the model. Resizing first is what this
        # band measurement exists to correct for, and doing it here cost seven
        # eighths of the detections when the counter did the same thing.
        result = yolo.predict(frame, imgsz=640, classes=classes, conf=0.25, verbose=False)[0]
        if result.boxes is None:
            continue
        height = frame.shape[0]
        for _, y, _, _ in result.boxes.xywh.tolist():
            index = min(bands - 1, max(0, int(y / height * bands)))
            tally[index] += 1
    capture.release()

    total = sum(tally) or 1
    return {round((i + 0.5) / bands, 3): round(100 * n / total, 1)
            for i, n in enumerate(tally) if n}


def verdict(net: dict, seen: dict) -> tuple[bool, str]:
    if not net.get("ok"):
        return False, net.get("reason", "unreachable")
    if net["realtime_factor"] < MIN_REALTIME_FACTOR:
        return False, f"only {net['realtime_factor']}x real time, needs {MIN_REALTIME_FACTOR}x"
    if not seen.get("ok"):
        return False, seen.get("reason", "no frames")
    if seen["fps"] < MIN_FPS:
        return False, f"{seen['fps']} fps is too few to track anything"
    if seen["uptime"] < 0.99:
        return False, f"uptime {seen['uptime']} would invalidate every market"
    if seen["counts"] == [0, 0]:
        return False, "no crossings detected; the count line needs placing for this scene"
    # Direct readers land on different segment boundaries; the relay removes it.
    if seen["frame_gap"] != 0:
        return True, f"usable via the relay ({seen['frame_gap']} frame drift on direct pulls)"
    return True, "usable"


def main() -> int:
    parser = argparse.ArgumentParser(prog="scry-probe")
    parser.add_argument("sources", nargs="+", help="watch pages or m3u8 urls")
    parser.add_argument("--seconds", type=float, default=45)
    parser.add_argument("--stream", default="", help="stream id, for its scene")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    results = []
    for source in args.sources:
        playlist = resolve(source)
        if not playlist:
            results.append({"source": source, "usable": False, "why": "could not resolve"})
            print(f"  {source[:40]:42} could not resolve", flush=True)
            continue

        net = throughput(playlist)
        seen = watch(playlist, args.seconds, args.stream) if net.get("ok") else {"ok": False}
        usable, why = verdict(net, seen)

        results.append({"source": source, "usable": usable, "why": why,
                        "network": net, "observed": seen})
        mark = "OK  " if usable else "no  "
        detail = (f"{net.get('realtime_factor', 0)}x realtime  "
                  f"{seen.get('fps', 0)} fps  uptime {seen.get('uptime', 0)}  "
                  f"gap {seen.get('frame_gap', '-')}  counts {seen.get('counts', '-')}")
        print(f"  {mark}{source[:38]:40} {detail}   {why}", flush=True)

    if args.json:
        print(json.dumps(results, indent=2))
    return 0 if any(r["usable"] for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
