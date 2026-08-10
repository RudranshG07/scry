"""Re-inspects submitted streams and reports what it finds.

A link qualifies once at submission and then drifts: the broadcast ends, the
camera is re-aimed, night falls, the scene empties. A market on a stream nobody
can count only ever voids, so every stream is looked at again on a cadence and
suspended when it stops being countable.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from dataclasses import asdict

from .qualify import inspect


def get(url: str) -> list[dict]:
    with urllib.request.urlopen(url, timeout=20) as response:
        return json.loads(response.read())


def report(api: str, stream_id: str, verdict) -> int:
    body = json.dumps({
        "usable": verdict.usable,
        "reason": verdict.reason,
        "counts": verdict.counts,
        "subjects": verdict.subjects,
        "peak": verdict.peak,
        "disagreement": verdict.disagreement,
        "provisional": verdict.provisional,
        "threshold": verdict.threshold,
        "scene": verdict.scene,
    }).encode()
    request = urllib.request.Request(
        f"{api.rstrip('/')}/v1/streams/{stream_id}/qualification",
        data=body, method="POST", headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code


def sweep(api: str, seconds: float) -> int:
    try:
        due = get(f"{api.rstrip('/')}/v1/streams/pending")
    except Exception as error:
        print(f"api unreachable: {error}", file=sys.stderr, flush=True)
        return 1

    if not due:
        print("no stream is due inspection", flush=True)
        return 0

    for stream in due:
        verdict = inspect(stream["sourceUrl"], seconds=seconds, claim=stream.get("claim"))
        status = report(api, stream["id"], verdict)
        mark = "keeps" if verdict.usable else "loses"
        print(f"  {stream['id']}: {mark} its place — {verdict.reason} "
              f"({verdict.subjects} {verdict.counts or 'subjects'}) -> {status}", flush=True)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="scry-inspector")
    parser.add_argument("--api", default="http://127.0.0.1:8080")
    parser.add_argument("--seconds", type=float, default=45)
    parser.add_argument("--every", type=float, default=0,
                        help="keep sweeping on this interval instead of running once")
    args = parser.parse_args()

    if not args.every:
        return sweep(args.api, args.seconds)

    while True:
        sweep(args.api, args.seconds)
        time.sleep(args.every)


if __name__ == "__main__":
    sys.exit(main())
