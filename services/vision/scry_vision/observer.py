"""Counts vehicles crossing a line on a live stream and reports the total.

The observer never touches the database. It watches, counts, and submits a
report over HTTP, because observers are meant to be independent processes that
could be running anywhere.
"""

from __future__ import annotations

import json
import time
import urllib.request
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from math import hypot

import cv2
import numpy as np

from .counter import CountLineTracker
from .evidence import bundle, chain, digest, stamp
from .health import Health, faults
from .models import CountLine, CounterConfig, CrossingDirection, Point, TrackSample

# How far a centroid may move between frames and still be the same vehicle.
MAX_DRIFT = 70
# Frames a track survives without a match before it is dropped.
MAX_MISSES = 8
# Consecutive failed reads that mean the capture is gone rather than stuttering.
RECONNECT_AFTER = 30
RECONNECT_PAUSE = 2.0


@dataclass(frozen=True)
class Profile:
    """Detector settings. Two observers watching the same camera with the same
    settings will agree even when both are wrong, so the verification observer
    runs a deliberately different configuration. Disagreement between profiles
    is a signal that the scene is hard to read, which is what consensus is for.
    """

    name: str
    min_area: int
    var_threshold: int
    history: int

    @property
    def version(self) -> str:
        return f"mog2-centroid/0.1-{self.name}"


PRIMARY = Profile(name="primary", min_area=300, var_threshold=40, history=250)
VERIFY = Profile(name="verify", min_area=220, var_threshold=55, history=150)

PROFILES = {"primary_vision": PRIMARY, "verification": VERIFY, "edge": PRIMARY}
MODEL_VERSION = PRIMARY.version


@dataclass
class Track:
    id: str
    centroid: Point
    misses: int = 0


class Centroids:
    """Nearest-neighbour tracker. Good enough for a fixed camera where vehicles
    move predictably and never overlap for long."""

    def __init__(self) -> None:
        self._tracks: dict[str, Track] = {}
        self._next = 0

    def update(self, centroids: list[Point]) -> list[tuple[str, Point]]:
        for track in self._tracks.values():
            track.misses += 1

        matched: list[tuple[str, Point]] = []
        taken: set[str] = set()

        for point in centroids:
            best, distance = None, MAX_DRIFT
            for track in self._tracks.values():
                if track.id in taken:
                    continue
                gap = hypot(track.centroid.x - point.x, track.centroid.y - point.y)
                if gap < distance:
                    best, distance = track, gap

            if best is None:
                self._next += 1
                best = Track(id=f"t{self._next}", centroid=point)
                self._tracks[best.id] = best

            best.centroid = point
            best.misses = 0
            taken.add(best.id)
            matched.append((best.id, point))

        for id_ in [t.id for t in self._tracks.values() if t.misses > MAX_MISSES]:
            del self._tracks[id_]

        return matched


def detect(mask: np.ndarray, min_area: int) -> list[tuple[Point, float]]:
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    found = []
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < min_area:
            continue
        x, y, w, h = cv2.boundingRect(contour)
        centroid = Point(x=x + w / 2, y=y + h / 2)
        # Bigger, more solid blobs are more likely to be a vehicle than a gust
        # of foliage, so area stands in for confidence.
        found.append((centroid, min(0.99, 0.5 + area / 4000)))
    return found


def observe(url: str, line: CountLine, seconds: float, profile: Profile = PRIMARY,
            width: int = 640, height: int = 360) -> dict:
    capture = cv2.VideoCapture(url)
    if not capture.isOpened():
        return {"ok": False, "reason": "stream_unreachable"}

    fps = capture.get(cv2.CAP_PROP_FPS) or 15.0
    # The window is a stretch of time, not a number of frames. Counting frames
    # instead lets two observers on the same market cover different stretches of
    # road, and the traffic between them reads as disagreement.
    deadline = datetime.now(UTC) + timedelta(seconds=seconds)
    expected = seconds * fps

    background = cv2.createBackgroundSubtractorMOG2(
        history=profile.history, varThreshold=profile.var_threshold, detectShadows=True)
    shape = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))

    counter = CountLineTracker(line, CounterConfig(minimum_confidence=0.6, deadband_distance=3))
    samples: list[dict] = []
    bucket_seconds = 60
    bucket_started = datetime.now(UTC)
    bucket_base = 0
    tracker = Centroids()
    health = Health()
    started = datetime.now(UTC)
    previous: np.ndarray | None = None

    # Chained across the whole window, so each interval's digest also commits
    # to every frame before it. Seeded with the source and start time so a
    # chain cannot be lifted from one observation onto another.
    frames = digest(f"{url}|{started.isoformat()}".encode())

    misses = 0
    while datetime.now(UTC) < deadline:
        ok, frame = capture.read()
        if not ok:
            health.dropped += 1
            misses += 1
            # These feeds arrive with barely more throughput than their bitrate,
            # so a long read falls behind and the capture gives up partway. Take
            # a fresh one and keep counting rather than abandon the window.
            if misses >= RECONNECT_AFTER:
                capture.release()
                capture = cv2.VideoCapture(url)
                misses = 0
                if not capture.isOpened():
                    time.sleep(RECONNECT_PAUSE)
            continue

        misses = 0
        health.frames += 1
        small = cv2.resize(frame, (width, height))
        grey = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        health.contrast.append(float(grey.std()))
        frames = chain(frames, grey.tobytes())

        # An identical frame means the encoder is repeating itself.
        if previous is not None and np.array_equal(grey, previous):
            health.frozen_run += 1
            health.longest_frozen = max(health.longest_frozen, health.frozen_run)
        else:
            health.frozen_run = 0
        previous = grey

        mask = background.apply(small)
        mask[mask < 200] = 0
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, shape)
        mask = cv2.dilate(mask, shape, iterations=2)

        detections = detect(mask, profile.min_area)
        now = datetime.now(UTC)
        for track_id, point in tracker.update([c for c, _ in detections]):
            confidence = next((s for c, s in detections if c is point), 0.6)
            counter.ingest(TrackSample(track_id, now, point, confidence, "vehicle"))

        elapsed_bucket = (now - bucket_started).total_seconds()
        if elapsed_bucket >= bucket_seconds:
            samples.append({
                "observedAt": stamp(bucket_started),
                "count": counter.count - bucket_base,
                "intervalSeconds": int(elapsed_bucket),
                "streamQuality": round(health.visibility(), 4),
                "modelVersion": profile.version,
                "frameDigest": frames,
            })
            bucket_base = counter.count
            bucket_started = now

    capture.release()
    finished = datetime.now(UTC)
    elapsed = (finished - started).total_seconds()

    tail = (finished - bucket_started).total_seconds()
    if tail >= 1:
        samples.append({
            "observedAt": stamp(bucket_started),
            "count": counter.count - bucket_base,
            "intervalSeconds": int(tail),
            "streamQuality": round(health.visibility(), 4),
            "modelVersion": profile.version,
            "frameDigest": frames,
        })

    return {
        "ok": health.frames > 0,
        "count": counter.count,
        "uptime": round(health.uptime(expected), 4),
        "visibility": round(health.visibility(), 4),
        "frozenSeconds": round(health.longest_frozen / fps, 2),
        "frames": health.frames,
        "elapsed": round(elapsed, 1),
        "modelVersion": profile.version,
        "evidenceRoot": bundle(samples)[0],
        "counts": samples,
    }


def horizontal_line(height: int = 360, width: int = 640, at: float = 0.6) -> CountLine:
    y = height * at
    return CountLine(start=Point(x=0, y=y), end=Point(x=width, y=y),
                     accepted_direction=CrossingDirection.POSITIVE_TO_NEGATIVE)


def submit(api: str, market: str, observer: str, role: str, result: dict) -> tuple[int, str]:
    reasons = faults(result["ok"], result.get("uptime", 0), result.get("visibility", 0))

    body = json.dumps({
        "observerId": observer,
        "role": role,
        "observedValue": result.get("count", 0),
        "confidence": 0.9 if result["ok"] else 0.0,
        "modelVersion": result.get("modelVersion", MODEL_VERSION),
        "uptime": result.get("uptime", 0.0),
        "maximumTimestampDriftMs": 0.0,
        "averageVisibility": result.get("visibility", 0.0),
        "longestFrozenSeconds": result.get("frozenSeconds", 0.0),
        "invalidReasons": reasons,
        "evidenceRoot": result.get("evidenceRoot") or None,
        "counts": result.get("counts", []),
    }).encode()

    request = urllib.request.Request(
        f"{api.rstrip('/')}/v1/markets/{market}/observations",
        data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return response.status, response.read().decode()
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode()
