#!/bin/sh
# Pulls one camera and republishes it, given only the path name.
#
# The source is asked for by stream id rather than written into the config, so a
# stream submitted an hour ago is relayed without anyone editing a file. That is
# the whole point: cameras rotate, and half of ours died within a day.
set -eu

path="${1:?path required}"
api="${SCRY_API:-http://host.docker.internal:8080}"

# Frames a second the relay publishes. Must match SAMPLE_FPS in
# services/vision/scry_vision/crossings.py: the observers count at that cadence,
# and a relay serving less than it cannot be counted at it.
fps="${SCRY_RELAY_FPS:-8}"

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
# Video is re-encoded to drop it to the cadence the observers count at. It used
# to be copied, on the grounds that the relay moves bytes and transcoding every
# camera would cost more than the counting does. That had it backwards: the
# observer decoded all thirty frames a second and threw away twenty-two of them
# immediately, because it counts eight. Decoding those discards was the single
# largest cost in the pipeline — a full second of work per second of footage,
# leaving nothing for inference, so no observer ever kept up with a live stream
# and every window it counted came in under the uptime floor.
#
# Dropping them here rather than there pays the cost once per camera instead of
# once per observer per camera, and it is the same eight frames either way: the
# resolution is untouched and the detector sees exactly what it saw before.
#
# -g matches the cadence so there is a keyframe every second, which is what
# hlsSegmentDuration in mediamtx.yml is cutting on. Without it the segmenter
# waits for the encoder's default interval and the segments stop being a second.
#
# Audio is re-encoded because a camera's audio is as likely to be something RTSP
# will not carry as not, and it is a rounding error next to the video.
exec ffmpeg -hide_banner -loglevel error -nostdin \
  -i "${playlist}" \
  -map 0:v:0 -map "0:a:0?" \
  -r "${fps}" -c:v libx264 -preset veryfast -tune zerolatency -g "${fps}" \
  -c:a aac -b:a 96k \
  -f rtsp -rtsp_transport tcp "rtsp://127.0.0.1:8554/${path}"
