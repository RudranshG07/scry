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
# Three, not two. A news stream repeated "the failure of" twice in fifty
# seconds and that came back as a catchphrase — two of anything inside a short
# listen is how language repeats, not how somebody talks.
MIN_SAYINGS = 3

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


def propose_phrase(url: str, seconds: float = TRIAL_SECONDS) -> tuple[str | None, int, str]:
    """The thing this stream says often enough to count.

    A catchphrase cannot be searched for, only heard. Whoever is talking decides
    what they repeat, so the phrase is measured off the stream the same way a
    count line is, rather than picked from a list somebody wrote in advance.
    """
    from .phrases import listen, phrases_in

    heard, seconds_heard = listen(url, seconds)
    if seconds_heard <= 0 or not heard.strip():
        return None, 0, "nothing was said"

    repeated = phrases_in(heard)
    if not repeated:
        return None, 0, "there is speech but nothing repeats"

    # Longest wins ties: "hello guys" is a phrase somebody would take a position
    # on, "hello" on its own is half of one.
    phrase, count = max(repeated.items(), key=lambda kv: (kv[1], len(kv[0].split())))
    return phrase, count, f'said "{phrase}" {count} times'


def assess_audio(url: str, seconds: float = TRIAL_SECONDS) -> dict:
    """Whether this link can host a phrase market, and on what phrase."""
    from .probe import resolve

    playlist = resolve(url)
    if not playlist:
        return {"url": url, "usable": False, "reason": "no live stream at that link"}

    phrase, count, note = propose_phrase(playlist, seconds)
    if phrase is None or count < MIN_SAYINGS:
        return {"url": url, "usable": False, "reason": note}

    return {
        "url": url,
        "usable": True,
        "reason": f"{note} in {seconds:.0f}s",
        "category": "Speech",
        "claim": {"kind": "phrase", "target": phrase, "options": {}},
    }


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
    # Provisional here is measured against how many subjects stand in frame,
    # because an inspection with no line to test cannot count crossings. That is
    # the wrong yardstick for a line claim and benched Bangkok's Sukhumvit Road
    # at midday. Only a scene with almost nothing in it is skipped; the rest go
    # on to be judged on what actually crosses.
    from .qualify import MIN_SUBJECTS

    if seen.subjects < MIN_SUBJECTS:
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
    parser.add_argument("--query", default="")
    parser.add_argument("--listen", action="store_true",
                        help="look for things being said rather than things crossing a line")
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--seconds", type=float, default=TRIAL_SECONDS)
    parser.add_argument("--timezone", default="UTC")
    parser.add_argument("--api", default="http://127.0.0.1:8080")
    parser.add_argument("--token", default="")
    parser.add_argument("--submit", action="store_true",
                        help="add what qualifies, rather than only reporting it")
    args = parser.parse_args()

    query = args.query or ("live stream just chatting talking"
                           if args.listen else "live traffic camera intersection 24/7")
    found = live_candidates(query, args.limit)
    if not found:
        print("nothing live matched that search", flush=True)
        return 0

    kept = 0
    for candidate in found:
        look = assess_audio if args.listen else assess
        verdict = look(candidate["url"], args.seconds)
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
