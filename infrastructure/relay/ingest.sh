#!/bin/sh
# Pulls one camera and republishes it, given only the path name.
#
# The source is asked for by stream id rather than written into the config, so a
# stream submitted an hour ago is relayed without anyone editing a file. That is
# the whole point: cameras rotate, and half of ours died within a day.
set -eu

path="${1:?path required}"
api="${SCRY_API:-http://host.docker.internal:8080}"

source_url=$(
  wget -q -O- "${api}/v1/streams" 2>/dev/null |
  sed 's/},{/}\n{/g' |
  grep "\"id\":\"${path}\"" |
  sed 's/.*"sourceUrl":"\([^"]*\)".*/\1/'
)

if [ -z "${source_url}" ]; then
  echo "relay: ${api} lists no source for ${path}" >&2
  exit 1
fi

case "${source_url}" in
  *.m3u8*) playlist="${source_url}" ;;
  *)       playlist=$(yt-dlp -g -f 'best[protocol^=m3u8]/best' --no-warnings "${source_url}" | head -1) ;;
esac

if [ -z "${playlist}" ]; then
  echo "relay: could not resolve a playlist for ${path}" >&2
  exit 1
fi

# One video track and at most one audio track. Copying everything took the
# subtitle and timed-metadata tracks with it, which RTSP cannot describe, and
# the publish died on "invalid SDP: clock rate not found" before a byte moved.
#
# Video is copied rather than re-encoded — the relay moves bytes, and
# transcoding every camera would cost more than the counting does. Audio is
# re-encoded because a camera's audio is as likely to be something RTSP will
# not carry as not, and it is a rounding error next to the video.
exec ffmpeg -hide_banner -loglevel error -nostdin \
  -i "${playlist}" \
  -map 0:v:0 -map "0:a:0?" \
  -c:v copy -c:a aac -b:a 96k \
  -f rtsp -rtsp_transport tcp "rtsp://127.0.0.1:8554/${path}"
