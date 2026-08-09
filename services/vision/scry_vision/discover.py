"""Finds live streams worth running markets on, and places their count line.

Nobody is going to sit and swap cameras. Of four qualified in one sitting, one
had ended and one had vanished within hours, and channels that restart daily
mint a new id every morning, so the pool drains on its own unless something
refills it.

The line is measured rather than chosen. Candidates are tried against the real
counter and the one that actually counts wins, because position was guessed from
motion statistics four separate times here and was wrong every time.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request

from .claims import Claim

# Enough to tell a busy road from an empty one without spending four minutes on
# a camera that turns out to be a fish tank.
TRIAL_SECONDS = 25
MIN_CROSSINGS = 2

CANDIDATES = {
    "across the middle": [[0.05, 0.50], [0.95, 0.50]],
    "across the near lane": [[0.05, 0.65], [0.95, 0.65]],
    "across the far side": [[0.05, 0.42], [0.95, 0.42]],
    "down the middle": [[0.50, 0.25], [0.50, 0.85]],
}


def live_candidates(query: str, limit: int) -> list[dict]:
    """Live streams matching a search, newest first."""
    from .probe import _ytdlp

    raw = _ytdlp(["--flat-playlist", "-J", "--no-warnings", f"ytsearch{limit}:{query}"])
    if not raw:
        return []
    try:
        entries = json.loads(raw).get("entries") or []
    except json.JSONDecodeError:
        return []

    found = []
    for entry in entries:
        if entry.get("live_status") != "is_live" and not entry.get("is_live"):
            continue
        found.append({
            "id": entry.get("id"),
            "title": (entry.get("title") or "").strip(),
            "url": entry.get("url") or f"https://www.youtube.com/watch?v={entry.get('id')}",
        })
    return found


def propose_line(playlist: str, target: str, seconds: float = TRIAL_SECONDS) -> tuple[list | None, int, str]:
    """The candidate line that counts the most, or nothing if none of them do."""
    from .crossings import Crossings

    watcher = Crossings()
    best: tuple[list | None, int, str] = (None, 0, "nothing crossed any line tried")
    for note, line in CANDIDATES.items():
        claim = Claim(stream_id="discovery", kind="crossings", target=target,
                      options={"line": line, "direction": "both"})
        reading = watcher.observe(playlist, claim, seconds, "primary_vision")
        if reading.count > best[1]:
            best = (line, reading.count, note)
    return best


def assess(url: str, seconds: float = TRIAL_SECONDS) -> dict:
    """Whether this link can host markets, and what it should count."""
    from .qualify import inspect
    from .probe import resolve

    playlist = resolve(url)
    if not playlist:
        return {"url": url, "usable": False, "reason": "no live stream at that link"}

    # Occupancy first: it is much cheaper than four counting passes and rejects
    # the empty, the dark and the unreadable before any line is tried.
    seen = inspect(url, seconds=seconds)
    if not seen.usable:
        return {"url": url, "usable": False, "reason": seen.reason}
    # Provisional means the camera is fine and the scene is empty at this hour.
    # Trying four lines against an empty road is two minutes to learn nothing;
    # the next sweep catches it when there is something to see.
    if seen.provisional:
        return {"url": url, "usable": False, "reason": seen.reason}

    target = "person" if seen.counts == "people" else "anything"
    line, count, note = propose_line(playlist, target, seconds)
    if line is None or count < MIN_CROSSINGS:
        return {"url": url, "usable": False,
                "reason": f"things are in view but nothing crosses a line ({note})"}

    return {
        "url": url,
        "usable": True,
        "reason": f"{count} crossings in {seconds:.0f}s {note}",
        "category": "Footfall" if target == "person" else "Traffic",
        "claim": {"kind": "crossings", "target": target,
                  "options": {"line": line, "direction": "both"}},
    }


def submit(api: str, token: str, name: str, url: str, verdict: dict, timezone: str) -> int:
    body = json.dumps({
        "sourceUrl": url,
        "name": name,
        "region": "Unknown",
        "timezone": timezone,
        "category": verdict.get("category", "Traffic"),
        "claim": verdict["claim"],
    }).encode()
    request = urllib.request.Request(
        f"{api.rstrip('/')}/v1/streams", data=body, method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code


def main() -> int:
    parser = argparse.ArgumentParser(prog="scry-discover")
    parser.add_argument("--query", default="live traffic camera intersection 24/7")
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--seconds", type=float, default=TRIAL_SECONDS)
    parser.add_argument("--timezone", default="UTC")
    parser.add_argument("--api", default="http://127.0.0.1:8080")
    parser.add_argument("--token", default="")
    parser.add_argument("--submit", action="store_true",
                        help="add what qualifies, rather than only reporting it")
    args = parser.parse_args()

    found = live_candidates(args.query, args.limit)
    if not found:
        print("nothing live matched that search", flush=True)
        return 0

    kept = 0
    for candidate in found:
        verdict = assess(candidate["url"], args.seconds)
        mark = "takes" if verdict["usable"] else "fails"
        print(f"  {candidate['title'][:52]:<52} {mark} — {verdict['reason']}", flush=True)
        if not verdict["usable"]:
            continue
        kept += 1
        if args.submit:
            if not args.token:
                print("    not submitted: no operator token", flush=True)
                continue
            status = submit(args.api, args.token, candidate["title"], candidate["url"],
                            verdict, args.timezone)
            print(f"    submitted -> {status}", flush=True)

    print(f"{kept} of {len(found)} live streams can host markets", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
