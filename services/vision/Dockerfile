# Observers and the inspector: one image, and compose picks the command, so a
# counting fix reaches both observers and the inspector at once.
#
# ffmpeg pulls frames for vision claims and audio for phrase claims. node is the
# JavaScript runtime yt-dlp needs to hold a YouTube live stream past its first
# forty seconds, and trixie is the first Debian whose node is new enough for it.
FROM python:3.13-slim-trixie

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg nodejs ca-certificates libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml ./
COPY scry_vision ./scry_vision
# CPU wheels. The default torch wheel on x86 brings gigabytes of CUDA nothing
# here can use.
RUN pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu torch torchvision \
 && pip install --no-cache-dir .

# Detector weights, whisper models and each observer's ledger of what it counted
# land in the working directory, which compose mounts. A restart then neither
# downloads the models again nor forgets a count it still has to sign for.
WORKDIR /data
ENV PYTHONUNBUFFERED=1 HF_HOME=/data/huggingface SCRY_OBSERVER_LEDGER=/data/ledger
ENTRYPOINT ["python", "-m"]
CMD ["scry_vision.worker", "--help"]
