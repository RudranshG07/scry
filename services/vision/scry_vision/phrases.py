"""Counts how often something is said on a stream.

The claim names the words. Audio is pulled with ffmpeg, transcribed with
Whisper, and each match is kept with the second it happened at, so the evidence
is a transcript anyone can check against the recording rather than a hash they
have to take on faith.

Two sizes of model stand in for two observers, the same way two detector weights
do for vision: they disagree on mumbled or overlapping speech, which is the
disagreement the quorum exists to catch.
"""

from __future__ import annotations

import re
import subprocess
import tempfile
import wave
from dataclasses import dataclass
from functools import lru_cache

from .claims import Claim, Reading
from .evidence import bundle, digest

# Whisper works on 16k mono, and pulling anything larger is wasted bandwidth.
SAMPLE_RATE = 16_000


@dataclass(frozen=True)
class Ear:
    name: str
    size: str

    @property
    def version(self) -> str:
        return f"whisper-{self.size}/1.0-{self.name}"


PRIMARY = Ear(name="primary", size="small")
VERIFY = Ear(name="verify", size="base")

EARS = {"primary_vision": PRIMARY, "verification": VERIFY, "edge": VERIFY}


@lru_cache(maxsize=4)
def _load(size: str):
    from faster_whisper import WhisperModel

    return WhisperModel(size, device="cpu", compute_type="int8")


def normalise(text: str) -> str:
    """Strip everything a speaker cannot be held to.

    Punctuation and case are the transcriber's choices, not the speaker's, so
    "Hello, guys!" and "hello guys" are the same utterance and must not depend
    on which model heard it.
    """
    return re.sub(r"[^a-z0-9 ]+", " ", text.lower()).strip()


def occurrences(text: str, target: str) -> int:
    """How many times the target is said in this text.

    Counted on word boundaries so "hello guys" does not fire inside
    "othello guysborough", and overlapping matches are not double counted.
    """
    words = normalise(text).split()
    wanted = normalise(target).split()
    if not wanted or len(words) < len(wanted):
        return 0

    hits = 0
    index = 0
    while index <= len(words) - len(wanted):
        if words[index:index + len(wanted)] == wanted:
            hits += 1
            index += len(wanted)
        else:
            index += 1
    return hits


def pull_audio(url: str, seconds: float) -> str | None:
    """Grab the audio track alone. Video is the majority of the bytes and none
    of the signal for a phrase."""
    handle = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    handle.close()
    result = subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-t", str(seconds), "-i", url,
         "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE), handle.name],
        capture_output=True, timeout=seconds * 4 + 60,
    )
    return handle.name if result.returncode == 0 else None


def captured(path: str) -> float:
    """Seconds of audio actually written.

    ffmpeg exits cleanly on a stream that cut out early, so returncode says
    nothing about how much of the window was heard. A phrase counted over
    fifteen seconds of a five minute window is not the same claim.
    """
    try:
        with wave.open(path) as track:
            return track.getnframes() / float(track.getframerate() or SAMPLE_RATE)
    except (OSError, wave.Error):
        return 0.0


class Phrases:
    kind = "phrase"

    def supports(self, claim: Claim) -> bool:
        return bool(normalise(claim.target))

    def qualify(self, url: str, claim: Claim, seconds: float = 45) -> tuple[bool, str]:
        reading = self.observe(url, claim, seconds, "primary_vision")
        if reading.detail.get("words", 0) == 0:
            return False, "no speech was heard on this stream"
        if reading.count == 0:
            # Speech is there and the phrase is not. A market on it settles at
            # zero every window, which is worth saying now rather than later.
            return False, f'nobody said "{claim.target}" while listening'
        return True, f'"{claim.target}" said {reading.count} times in {seconds:.0f}s'

    def observe(self, url: str, claim: Claim, seconds: float, role: str) -> Reading:
        audio = pull_audio(url, seconds)
        if audio is None:
            return Reading(0, [], detail={"reason": "no audio track"})

        ear = EARS[role]
        # Word timestamps, not segment ones: three utterances inside one segment
        # otherwise share its start time, and evidence nobody can scrub to is
        # not evidence.
        segments, _ = _load(ear.size).transcribe(
            audio, language=claim.options.get("language"), word_timestamps=True)

        said: list[dict] = []
        words = 0
        wanted = normalise(claim.target).split()

        for segment in segments:
            # float(), because whisper hands back numpy scalars and those do not
            # survive json, which is how evidence reaches the API.
            spoken = [(normalise(w.word).strip(), float(w.start)) for w in (segment.words or [])]
            spoken = [(word, at) for word, at in spoken if word]
            words += len(spoken) or len(normalise(segment.text).split())

            index = 0
            while index <= len(spoken) - len(wanted):
                if [word for word, _ in spoken[index:index + len(wanted)]] == wanted:
                    said.append({
                        "at": round(spoken[index][1], 2),
                        "heard": segment.text.strip(),
                        "modelVersion": ear.version,
                    })
                    index += len(wanted)
                else:
                    index += 1

        heard = captured(audio)
        return Reading(
            count=len(said),
            samples=said,
            uptime=round(min(1.0, heard / seconds), 4) if seconds > 0 else 0.0,
            evidence_root=bundle(said)[0] if said else digest(f"{url}|silence".encode()),
            detail={"words": words, "model": ear.version, "heardSeconds": round(heard, 2)},
        )
