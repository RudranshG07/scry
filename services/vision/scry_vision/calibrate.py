"""Measures how far two observer profiles drift apart on one camera.

A single window says almost nothing: the same camera and the same settings have
produced 5.3% and 11.6% on consecutive runs. Anything read off one window is
noise, so this runs several and reports the shape of the distribution. Use it
before and after a detector change; a change that only moves the mean by less
than the spread has not been shown to do anything.
"""

from __future__ import annotations

import argparse
import statistics
import sys
import threading
from datetime import UTC, datetime


def spread(a: int, b: int) -> float:
    lo, hi = sorted((a, b))
    return 100.0 * (hi - lo) / lo if lo else 0.0


def summarise(runs: list[dict]) -> dict:
    good = [r for r in runs if r["ok"]]
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
        # With this few windows the spread of the spread is the whole story.
        "stdev": round(statistics.stdev(gaps), 2) if len(gaps) > 1 else None,
    }


def window(url: str, seconds: float) -> dict:
    from .observer import PRIMARY, VERIFY, horizontal_line, observe

    line = horizontal_line()
    out: dict[str, dict] = {}

    def go(key, profile):
        out[key] = observe(url, line, seconds=seconds, profile=profile)

    threads = [threading.Thread(target=go, args=("primary", PRIMARY)),
               threading.Thread(target=go, args=("verify", VERIFY))]
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
        "uptime": min(p["uptime"], v["uptime"]),
        "drift": round(abs(p["elapsed"] - v["elapsed"]), 1),
    }


def run(url: str, seconds: float, windows: int, bar: float) -> int:
    print(f"{windows} windows of {seconds:.0f}s on {url.rsplit('/', 2)[-2]}\n", flush=True)
    print(f"{'#':>2} {'primary':>8} {'verify':>7} {'spread':>7} {'uptime':>7} {'drift':>6}")

    runs = []
    for i in range(1, windows + 1):
        started = datetime.now(UTC)
        r = window(url, seconds)
        runs.append(r)
        if not r["ok"]:
            print(f"{i:>2} {'--':>8} {'--':>7}   failed: {r['reason']}", flush=True)
            continue
        print(f"{i:>2} {r['primary']:>8} {r['verify']:>7} {r['spread']:>6.1f}% "
              f"{r['uptime']:>7.3f} {r['drift']:>5.1f}s"
              f"   ({(datetime.now(UTC) - started).total_seconds():.0f}s)", flush=True)

    s = summarise(runs)
    if not s["windows"]:
        print("\nno usable windows")
        return 1

    print(f"\nmean {s['mean']}%  median {s['median']}%  best {s['best']}%  worst {s['worst']}%"
          + (f"  stdev {s['stdev']}%" if s["stdev"] is not None else ""))
    if s["failed"]:
        print(f"{s['failed']} window(s) produced no frames")

    # The mean alone invites false confidence. A detector whose spread swings by
    # more than the bar itself cannot be said to meet the bar, however good the
    # average looks.
    if s["stdev"] is not None and s["stdev"] > bar:
        print(f"\nUNSTABLE: run-to-run stdev {s['stdev']}% exceeds the {bar}% bar. "
              f"Differences smaller than that are not measurable here.")
        return 2
    verdict = "PASS" if s["mean"] <= bar else "FAIL"
    print(f"\n{verdict} against a {bar}% bar")
    return 0 if verdict == "PASS" else 1


def main() -> int:
    parser = argparse.ArgumentParser(prog="scry-calibrate")
    parser.add_argument("--camera", required=True, help="HLS url to measure")
    parser.add_argument("--seconds", type=float, default=120, help="length of one window")
    parser.add_argument("--windows", type=int, default=5)
    parser.add_argument("--bar", type=float, default=5.0,
                        help="agreement bar in percent, matching the resolver")
    args = parser.parse_args()
    return run(args.camera, args.seconds, args.windows, args.bar)


if __name__ == "__main__":
    sys.exit(main())
