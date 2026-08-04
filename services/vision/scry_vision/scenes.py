"""What each camera frames, and where its subjects cross.

Orientation and position both come from measurement. At Abbey Road pedestrians
travel sideways 3:1 over vertically, so a horizontal line was perpendicular to
the traffic and counted almost nothing whatever its height.

Use scry_vision.probe.busiest_band for position and the flow measurement for
orientation.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

from .models import CountLine, CrossingDirection, Point


@dataclass(frozen=True)
class Scene:
    name: str
    unit: str
    # Where the line sits across the axis it cuts, as a fraction of the frame.
    at: float
    # How far the line extends along its own axis.
    start: float
    end: float
    # Vertical counts sideways movement; horizontal counts movement toward and
    # away from the camera.
    vertical: bool = False

    def line(self, width: int = 640, height: int = 360) -> CountLine:
        if self.vertical:
            x = width * self.at
            return CountLine(
                start=Point(x=x, y=height * self.start),
                end=Point(x=x, y=height * self.end),
                accepted_direction=CrossingDirection.POSITIVE_TO_NEGATIVE,
            )
        y = height * self.at
        return CountLine(
            start=Point(x=width * self.start, y=y),
            end=Point(x=width * self.end, y=y),
            accepted_direction=CrossingDirection.POSITIVE_TO_NEGATIVE,
        )


FREEWAY = Scene(name="freeway", unit="vehicles", at=0.6, start=0.0, end=1.0)
CROSSING = Scene(name="crossing", unit="people", at=0.6, start=0.0, end=1.0)
STREET = Scene(name="street", unit="vehicles", at=0.6, start=0.0, end=1.0)

SCENES = {scene.name: scene for scene in (FREEWAY, CROSSING, STREET)}

# Per-camera geometry, measured rather than chosen by eye.
STREAM_LINES: dict[str, dict] = {
    # Travel here is 2612px sideways against 852px vertical, across x=320-633.
    "stream-london-abbey": {"at": 0.78, "start": 0.2, "end": 1.0, "vertical": True},
}

STREAM_SCENES: dict[str, str] = {
    "stream-sd-5-28th": "freeway",
    "stream-sd-8-15": "freeway",
    "stream-sd-8-taylor": "freeway",
    "stream-tokyo-shibuya": "crossing",
    "stream-tokyo-shinjuku": "street",
    "stream-london-abbey": "crossing",
    "stream-sf-bay-bridge": "freeway",
}


def scene_for(stream_id: str) -> Scene:
    base = SCENES[STREAM_SCENES.get(stream_id, "freeway")]
    override = STREAM_LINES.get(stream_id)
    return base if override is None else replace(base, **override)
