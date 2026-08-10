"""Counts things crossing a line the submitter drew.

The line arrives as two points in the claim, normalised so it survives whatever
resolution the stream happens to be. It is not inferred: position and
orientation were guessed from motion statistics four separate times here and
were wrong every time, while the person submitting the camera already knows
where the road is.

Identity comes from ByteTrack. A crossing is only a crossing if the thing on
both sides of the line is the same thing, and a tracker that loses identity
counts one car many times.
"""

from __future__ import annotations

from datetime import UTC, datetime

from .claims import Claim, Reading
from .counter import CountLineTracker
from .detector import MODELS, _load
from .evidence import bundle, chain, digest, stamp
from .health import Health
from .models import CountLine, CounterConfig, CrossingDirection, Point, TrackSample

# COCO classes worth counting on a road or a pavement.
COUNTABLE = {
    "person": 0,
    "bicycle": 1,
    "car": 2,
    "motorcycle": 3,
    "bus": 5,
    "truck": 7,
}
ANYTHING = "anything"

WIDTH, HEIGHT = 1280, 720

# Frames per second of footage that are actually counted. Every observer counts
# the same cadence whatever its hardware manages, which is what makes two of
# them comparable at all. Eight is enough for ByteTrack to hold a road user
# across the line at ordinary speeds.
SAMPLE_FPS = 8.0
SAMPLE_INTERVAL = 1.0 / SAMPLE_FPS


def classes_for(target: str) -> list[int]:
    return sorted(COUNTABLE.values()) if target == ANYTHING else [COUNTABLE[target]]


def line_from(claim: Claim) -> CountLine | None:
    """The submitter's line, in pixels.

    Stored normalised, so the same claim works whether the stream is 720p today
    and 1080p tomorrow.
    """
    points = claim.options.get("line")
    if not points or len(points) != 2:
        return None
    (x1, y1), (x2, y2) = points
    return CountLine(
        start=Point(x=x1 * WIDTH, y=y1 * HEIGHT),
        end=Point(x=x2 * WIDTH, y=y2 * HEIGHT),
        accepted_direction=CrossingDirection.POSITIVE_TO_NEGATIVE,
    )


class Crossings:
    """Counts a class of thing passing the claim's line."""

    kind = "crossings"

    def supports(self, claim: Claim) -> bool:
        return (claim.target in COUNTABLE or claim.target == ANYTHING) and bool(
            claim.options.get("line")
        )

    def qualify(self, url: str, claim: Claim, seconds: float = 45) -> tuple[bool, str]:
        if not claim.options.get("line"):
            return False, "no line was drawn on this stream"

        reading = self.observe(url, claim, seconds, "primary_vision")
        if reading.detail.get("frames", 0) == 0:
            return False, "no frames arrived"
        if reading.detail.get("seen", 0) == 0:
            return False, f"nothing that could be a {claim.target} appeared"
        if reading.count == 0:
            # The stream is fine and the line is in the wrong place, which is
            # worth saying at submission rather than after a week of markets
            # that all settle at zero.
            return False, "things are moving but none of them cross the line"
        return True, f"{reading.count} crossings in {seconds:.0f}s"

    def observe(self, url: str, claim: Claim, seconds: float, role: str) -> Reading:
        import cv2

        line = line_from(claim)
        if line is None:
            return Reading(0, [], detail={"reason": "no line"})

        model = MODELS[role]
        yolo = _load(model.weights)
        classes = classes_for(claim.target)

        # A two-way road needs both directions; a one-way needs one. Two
        # trackers rather than one, because the tested counter takes a single
        # direction and summing them is cheaper than reworking it.
        both = claim.options.get("direction", "both") == "both"
        config = CounterConfig(
            minimum_confidence=0.0, deadband_distance=3, accepted_categories=("subject",)
        )
        forward = CountLineTracker(line, config)
        backward = (
            CountLineTracker(
                CountLine(
                    start=line.end,
                    end=line.start,
                    accepted_direction=CrossingDirection.POSITIVE_TO_NEGATIVE,
                ),
                config,
            )
            if both
            else None
        )

        capture = cv2.VideoCapture(url)
        if not capture.isOpened():
            return Reading(0, [], detail={"reason": "stream unreachable"})

        started = datetime.now(UTC)
        deadline = started.timestamp() + seconds
        health = Health()
        frames = 0
        sampled = 0
        seen = 0
        last_position: float | None = None
        last_sampled: float | None = None
        chained = digest(f"{url}|{started.isoformat()}".encode())
        samples: list[dict] = []
        bucket_started = started
        bucket_base = 0

        while datetime.now(UTC).timestamp() < deadline:
            ok, frame = capture.read()
            if not ok:
                health.dropped += 1
                continue
            frames += 1

            # Gaps in the footage, not in arrival: HLS hands over a segment at a
            # time, so frames burst with silence between while missing nothing.
            position = capture.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
            if position > 0 and last_position is not None:
                health.saw_frame(max(0.0, position - last_position))
            if position > 0:
                last_position = position
            health.frames += 1

            # Count over a fixed cadence of footage, not over however many frames
            # this machine got through. Two observers on the same window detected
            # the same 14868 and 14871 objects and still reported 42 and 53
            # crossings: the faster model simply read 25% more frames, so its
            # tracker saw more of every trajectory. Left alone, the result of a
            # market depends on the hardware counting it.
            if last_sampled is not None and position > 0 and position - last_sampled < SAMPLE_INTERVAL:
                continue
            if position > 0:
                last_sampled = position

            sampled += 1
            chained = chain(chained, frame.tobytes())

            # Native frame, not a downscaled one: resizing before inference cost
            # roughly seven eighths of the detections here.
            result = yolo.track(
                frame,
                imgsz=640,
                conf=model.confidence,
                iou=model.iou,
                classes=classes,
                tracker="bytetrack.yaml",
                persist=True,
                verbose=False,
            )[0]

            boxes = result.boxes
            if boxes is None or boxes.id is None:
                continue

            now = datetime.now(UTC)
            height, width = frame.shape[:2]
            for (x, y, _, _), track_id, score in zip(
                boxes.xywh.tolist(), boxes.id.tolist(), boxes.conf.tolist()
            ):
                seen += 1
                point = Point(x=x / width * WIDTH, y=y / height * HEIGHT)
                sample = TrackSample(str(int(track_id)), now, point, score, "subject")
                forward.ingest(sample)
                if backward is not None:
                    backward.ingest(sample)

            now_at = datetime.now(UTC)
            if (now_at - bucket_started).total_seconds() >= 60:
                running = forward.count + (backward.count if backward else 0)
                samples.append({
                    "observedAt": stamp(bucket_started),
                    "count": running - bucket_base,
                    "intervalSeconds": int((now_at - bucket_started).total_seconds()),
                    "streamQuality": round(health.visibility() or 1.0, 4),
                    "modelVersion": model.version,
                    "frameDigest": chained,
                })
                bucket_base = running
                bucket_started = now_at

        capture.release()
        elapsed = (datetime.now(UTC) - started).total_seconds()
        count = forward.count + (backward.count if backward else 0)

        tail = (datetime.now(UTC) - bucket_started).total_seconds()
        if tail >= 1:
            samples.append({
                "observedAt": stamp(bucket_started),
                "count": count - bucket_base,
                "intervalSeconds": int(tail),
                "streamQuality": round(health.visibility() or 1.0, 4),
                "modelVersion": model.version,
                "frameDigest": chained,
            })

        return Reading(
            count=count,
            samples=samples,
            uptime=round(health.uptime(elapsed), 4),
            evidence_root=bundle(samples)[0],
            detail={"frames": frames, "sampled": sampled, "seen": seen, "model": model.version},
        )
