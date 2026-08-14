"""Scry's vision service.

The ffmpeg options below are set before anything imports cv2, because OpenCV
reads them once when its ffmpeg backend loads.
"""

import os as _os

# FFmpeg's HLS demuxer refuses segment URLs whose path carries no file
# extension, and every segment YouTube serves looks like
# /videoplayback/id/<id>/itag/... with none. The capture opened, sat there, and
# gave up five minutes later having read nothing:
#
#   URL https://rr2---sn-...googlevideo.com/videoplayback/... is not in allowed_extensions
#   Stream timeout triggered after 301740 ms
#
# Which reads from the outside exactly like a camera that has gone off air.
# rw_timeout is the other half. Without it a stalled read blocks forever: an
# inspection sweep sat on one camera for seventeen minutes —
#
#   Stream timeout triggered after 1061020 ms
#
# — and every stream behind it in the queue waited too. Fifteen seconds is far
# longer than any segment boundary and far shorter than a window.
_os.environ.setdefault(
    "OPENCV_FFMPEG_CAPTURE_OPTIONS",
    "allowed_extensions;ALL"
    "|protocol_whitelist;file,http,https,tcp,tls,crypto"
    "|rw_timeout;15000000",
)

from .counter import CountLineTracker
from .models import CountLine, CounterConfig, CrossingDirection, CrossingEvent, Point, TrackSample
from .pipeline import execute_counting

__all__ = [
    "CountLine",
    "CountLineTracker",
    "CounterConfig",
    "CrossingDirection",
    "CrossingEvent",
    "Point",
    "TrackSample",
    "execute_counting",
]

from .claims import register as _register  # noqa: E402
from .crossings import Crossings  # noqa: E402
from .objects import Objects  # noqa: E402
from .phrases import Phrases  # noqa: E402

_register(Crossings())
_register(Objects())
_register(Phrases())
