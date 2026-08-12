# mediamtx with a resolver attached.
#
# The stock image cannot ingest a watch page, only a playlist, and the playlists
# behind these cameras are signed and expire. yt-dlp turns one into the other.
#
# Installed from Alpine rather than dropped in as a release binary: the official
# yt-dlp builds are glibc x86-64, and this image is musl and runs on arm64 as
# often as not, so the binary died with a loader error before it printed a
# version.
FROM bluenviron/mediamtx:latest-ffmpeg

USER root
RUN apk add --no-cache yt-dlp ca-certificates

COPY ingest.sh /usr/local/bin/ingest
RUN chmod +x /usr/local/bin/ingest
