"""Measures how far two observer profiles drift apart on one camera.

One window says nothing: the same camera and settings produced 5.3% and 11.6% on
consecutive runs. A change that moves the mean by less than the spread has not
been shown to do anything.
"""

from __future__ import annotations

import argparse
import math
import statistics
import sys
import threading
from datetime import UTC, datetime

from .health import MIN_UPTIME


# Must match resolve.go, or this reports failures the engine would have settled.
TOLERANCE_PERCENT = 0.05
TOLERANCE_FLOOR = 2


def spread(a: int, b: int) -> float:
    lo, hi = sorted((a, b))
    return 100.0 * (hi - lo) / lo if lo else 0.0


def allowed_spread(base: int) -> int:
    return max(TOLERANCE_FLOOR, math.ceil(base * TOLERANCE_PERCENT))


def agrees(a: int, b: int) -> bool:
    lo, hi = sorted((a, b))
    return hi - lo <= allowed_spread(lo)


def summarise(runs: list[dict], settleable_only: bool = False) -> dict:
    """settleable_only drops windows the resolver would reject for uptime, whose
    disagreement is footage the detector never received."""
    good = [r for r in runs if r["ok"]]
    if settleable_only:
        good = [r for r in good if r["uptime"] >= MIN_UPTIME]
    if not good:
        return {"windows": 0}
    gaps = [r["spread"] for r in good]
    return {
        "windows": len(good),
        "failed": len(runs) - len(good),
        "mean": round(statistics.fmean(gaps), 2),
        "median": round(statistics.median(gaps), 2),
        "worst": round(max(gaps), 2),
        "best": round(min(gaps), 2),
        "stdev": round(statistics.stdev(gaps), 2) if len(gaps) > 1 else None,
        "settled": sum(1 for r in good if r.get("agrees")),
    }


def window(url: str, seconds: float, stream: str = "") -> dict:
    from .observer import observe
    from .scenes import scene_for

    scene = scene_for(stream)
    out: dict[str, dict] = {}

    def go(key, role):
        out[key] = observe(url, scene, seconds=seconds, role=role)

    threads = [threading.Thread(target=go, args=("primary", "primary_vision")),
               threading.Thread(target=go, args=("verify", "verification"))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    p, v = out.get("primary", {}), out.get("verify", {})
    if not (p.get("ok") and v.get("ok")):
        return {"ok": False, "reason": p.get("reason") or v.get("reason") or "no frames"}

    return {
        "ok": True,
        "primary": p["count"],
        "verify": v["count"],
        "spread": spread(p["count"], v["count"]),
        "agrees": agrees(p["count"], v["count"]),
        "uptime": min(p["uptime"], v["uptime"]),
        "drift": round(abs(p["elapsed"] - v["elapsed"]), 1),
    }


def run(url: str, seconds: float, windows: int, bar: float, stream: str = "") -> int:
    print(f"{windows} windows of {seconds:.0f}s on {url.rsplit('/', 2)[-2]}\n", flush=True)
    print(f"{'#':>2} {'primary':>8} {'verify':>7} {'spread':>7} {'uptime':>7} {'drift':>6}")

    runs = []
    for i in range(1, windows + 1):
        started = datetime.now(UTC)
        r = window(url, seconds, stream)
        runs.append(r)
        if not r["ok"]:
            print(f"{i:>2} {'--':>8} {'--':>7}   failed: {r['reason']}", flush=True)
            continue
        print(f"{i:>2} {r['primary']:>8} {r['verify']:>7} {r['spread']:>6.1f}% "
              f"{r['uptime']:>7.3f} {r['drift']:>5.1f}s  "
              f"{'settles' if r['agrees'] else 'rejects':>7}"
              f"   ({(datetime.now(UTC) - started).total_seconds():.0f}s)", flush=True)

    everything = summarise(runs)
    if not everything["windows"]:
        print("\nno usable windows")
        return 1

    print(f"\nall windows       mean {everything['mean']}%  median {everything['median']}%  "
          f"best {everything['best']}%  worst {everything['worst']}%"
          + (f"  stdev {everything['stdev']}%" if everything["stdev"] is not None else ""))
    if everything["failed"]:
        print(f"{everything['failed']} window(s) produced no frames")

    s = summarise(runs, settleable_only=True)
    if not s["windows"]:
        print(f"\nno window held {MIN_UPTIME:.0%} uptime, so none of these could have settled")
        return 1

    dropped = everything["windows"] - s["windows"]
    print(f"settleable only   mean {s['mean']}%  median {s['median']}%  "
          f"best {s['best']}%  worst {s['worst']}%"
          + (f"  stdev {s['stdev']}%" if s["stdev"] is not None else "")
          + (f"   ({dropped} dropped below {MIN_UPTIME:.0%} uptime)" if dropped else ""))

    # A spread that swings by more than the bar cannot be said to meet it.
    if s["stdev"] is not None and s["stdev"] > bar:
        print(f"\nUNSTABLE: run-to-run stdev {s['stdev']}% exceeds the {bar}% bar. "
              f"Differences smaller than that are not measurable here.")
        return 2
    print(f"\nthe engine would settle {s['settled']} of {s['windows']} settleable windows")
    verdict = "PASS" if s["settled"] == s["windows"] else "FAIL"
    print(f"{verdict} — mean spread {s['mean']}% against a {bar}% bar")
    return 0 if verdict == "PASS" else 1


def main() -> int:
    parser = argparse.ArgumentParser(prog="scry-calibrate")
    parser.add_argument("--camera", required=True, help="HLS url to measure")
    parser.add_argument("--seconds", type=float, default=120, help="length of one window")
    parser.add_argument("--windows", type=int, default=5)
    parser.add_argument("--stream", default="", help="stream id, for its scene")
    parser.add_argument("--bar", type=float, default=5.0,
                        help="agreement bar in percent, matching the resolver")
    args = parser.parse_args()
    return run(args.camera, args.seconds, args.windows, args.bar, args.stream)


if __name__ == "__main__":
    sys.exit(main())
