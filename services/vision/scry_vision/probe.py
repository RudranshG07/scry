"""Decides whether a camera can be observed from here.

Frames have to arrive faster than they are produced. A source with 15% headroom
looks healthy until it is not, and nothing downstream can tell that from a bad
detector, so a candidate is measured before it is trusted.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import threading
import urllib.request

MIN_REALTIME_FACTOR = 3.0
MIN_FPS = 10.0


def resolve(source: str) -> str | None:
    """Watch page to playlist url. Signed and expiring, so resolved at use."""
    if source.startswith("http") and ".m3u8" in source:
        return source
    try:
        out = subprocess.run(
            ["yt-dlp", "--no-update", "-g", "-f", "best[height<=720]", source],
            capture_output=True, text=True, timeout=90)
    except (OSError, subprocess.TimeoutExpired):
        return None
    url = out.stdout.strip().splitlines()
    return url[0] if url else None


def throughput(playlist: str) -> dict:
    """How much faster than real time the segments arrive."""
    import time

    try:
        with urllib.request.urlopen(playlist, timeout=20) as response:
            body = response.read().decode("utf-8", "replace")
    except Exception as error:
        return {"ok": False, "reason": f"playlist unreachable: {error}"}

    lines = [line.strip() for line in body.splitlines()]
    seconds = sum(float(line.split(":", 1)[1].rstrip(",")) for line in lines
                  if line.startswith("#EXTINF:"))
    segments = [line for line in lines if line and not line.startswith("#")]
    if not segments:
        return {"ok": False, "reason": "playlist lists no segments"}

    base = playlist.rsplit("/", 1)[0]
    downloaded = 0.0
    total_bytes = 0
    for name in segments[:3]:
        url = name if name.startswith("http") else f"{base}/{name}"
        started = time.monotonic()
        try:
            with urllib.request.urlopen(url, timeout=30) as response:
                total_bytes += len(response.read())
        except Exception as error:
            return {"ok": False, "reason": f"segment failed: {error}"}
        downloaded += time.monotonic() - started

    covered = seconds * (min(3, len(segments)) / len(segments))
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
    width, height = 640, 360

    capture = cv2.VideoCapture(playlist)
    if not capture.isOpened():
        return {}

    import time

    tally = [0] * bands
    started = time.monotonic()
    while time.monotonic() - started < seconds:
        ok, frame = capture.read()
        if not ok:
            continue
        result = yolo.predict(cv2.resize(frame, (width, height)), classes=classes,
                              conf=0.25, verbose=False)[0]
        if result.boxes is None:
            continue
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
