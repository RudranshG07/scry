"""Opening a camera, with a bound on how long that is allowed to take.

OpenCV's ffmpeg backend has two clocks and they are not the same one. The
options in OPENCV_FFMPEG_CAPTURE_OPTIONS are handed to ffmpeg; the interrupt
callback that gives up on a stalled read is OpenCV's own, and it only listens to
these two properties. Setting the first and not the second is why an inspection
sweep sat on one camera for seventeen minutes:

    Stream timeout triggered after 1061020 ms

while every stream queued behind it waited.
"""

from __future__ import annotations

OPEN_TIMEOUT_MS = 20_000
READ_TIMEOUT_MS = 15_000


def open_capture(url: str):
    """A VideoCapture that gives up rather than hanging."""
    import cv2

    return cv2.VideoCapture(url, cv2.CAP_FFMPEG, [
        cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, OPEN_TIMEOUT_MS,
        cv2.CAP_PROP_READ_TIMEOUT_MSEC, READ_TIMEOUT_MS,
    ])
