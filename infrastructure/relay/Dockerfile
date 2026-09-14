# mediamtx with a resolver attached.
#
# The stock image cannot ingest a watch page, only a playlist, and the playlists
# behind these cameras are signed and expire. yt-dlp turns one into the other.
#
# yt-dlp comes from pip with node beside it, not from Alpine, and it is not
# pinned. The Alpine package trailed by months, and a yt-dlp that old, with no
# JavaScript runtime, got 40 s of a YouTube live stream before every segment was
# refused. Measured 2026-09-15: 2026.08.19 with node held the same stream for
# 100 s without a single 403. YouTube changes underneath it, so when ingests
# start dying at the same second, rebuild this image before debugging anything.
FROM bluenviron/mediamtx:latest-ffmpeg

USER root
RUN apk add --no-cache ca-certificates nodejs python3 py3-pip \
 && pip install --no-cache-dir --break-system-packages "yt-dlp[default]"

COPY ingest.sh /usr/local/bin/ingest
RUN chmod +x /usr/local/bin/ingest
