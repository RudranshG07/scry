"""Whether the camera is still looking at what it was qualified on.

A count line is drawn on a scene. If the feed changes what it points at — a
venue camera cycling between rooms, an operator re-aiming, a channel splicing in
another angle — the line stays where it was and counts whatever now happens to
lie under it. Both observers see the identical wrong scene and agree perfectly,
so the quorum cannot catch it: Sukhumvit Soi 11 settled a market at 4 crossings
during rush hour that way, with full uptime and both observers within one.

The fingerprint is structural rather than photographic. Traffic moves, light
changes through the day and compression varies by segment, none of which should
count as a different scene; the arrangement of the fixed things in frame should.
"""

from __future__ import annotations

# Hamming distance between two 64 bit fingerprints. Below this is the same view
# under different traffic and light; above it the camera is somewhere else.
#
# Measured rather than guessed, on live cameras:
#   the same view sampled repeatedly        0 bits, exactly, every time
#   the same view at 854x480 vs 1920x1080   4 bits
#   the same road three hours later         18 bits
#   a different camera, or one that panned  30 to 36 bits
#
# The fingerprint is stable to the bit within a session, so the 18 is not noise:
# it is the sun moving. Dropping the DC term takes overall brightness out, but
# not where the shadows fall. That leaves a narrow gap between a day passing and
# a camera moving, and the only reason it holds is that streams are inspected
# every six hours, which re-bases the fingerprint before the light has moved
# that far.
MAX_DRIFT = 24

SIDE = 32
KEPT = 8


def fingerprint(frame) -> str:
    """A 64 bit perceptual hash of the frame's structure."""
    import cv2
    import numpy as np

    grey = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if frame.ndim == 3 else frame
    small = cv2.resize(grey, (SIDE, SIDE), interpolation=cv2.INTER_AREA)

    # DCT keeps the coarse layout in the top-left corner and pushes detail — the
    # cars, the pedestrians, the noise — into the high frequencies we discard.
    spectrum = cv2.dct(np.float32(small))[:KEPT, :KEPT]

    # The DC term is overall brightness, which is the time of day rather than
    # the scene, so the median is taken without it.
    flat = spectrum.flatten()
    bits = flat > float(np.median(flat[1:]))

    value = 0
    for bit in bits:
        value = (value << 1) | int(bit)
    return f"{value:016x}"


def background(frames) -> str:
    """A fingerprint of what stays put across several frames.

    One frame fingerprints the traffic as much as the road. Measured on Abbey
    Road, a camera that had not moved at all, single frames thirty seconds apart
    differed by up to 18 bits — more than the budget for telling a pan from a
    busy minute. The per-pixel median across samples drops whatever moved and
    leaves the buildings, the kerb and the markings, which is the thing the
    question "has this camera moved" is actually about.
    """
    import cv2
    import numpy as np

    if not frames:
        return ""
    small = [
        cv2.resize(
            cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if frame.ndim == 3 else frame,
            (SIDE, SIDE), interpolation=cv2.INTER_AREA)
        for frame in frames
    ]
    return fingerprint(np.median(np.stack(small), axis=0).astype(np.uint8))


def drift(a: str, b: str) -> int:
    """How far apart two fingerprints are, in bits."""
    if not a or not b:
        return 64
    try:
        return bin(int(a, 16) ^ int(b, 16)).count("1")
    except ValueError:
        return 64


def same_scene(a: str, b: str, limit: int = MAX_DRIFT) -> bool:
    return drift(a, b) <= limit
