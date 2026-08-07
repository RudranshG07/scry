"""What a market counts, and who can count it.

A market names a claim rather than assuming a camera pointed at a road. The
claim carries its own kind, and the kind decides which observer runs: pixels for
things crossing a line, audio for a phrase being said, and whatever comes next
without the engine, the quorum or the contracts knowing about it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


@dataclass(frozen=True)
class Claim:
    """One countable thing on one stream."""

    stream_id: str
    kind: str
    target: str
    # Whatever the kind needs and nothing else: a line for crossings, matching
    # rules for a phrase. Kept opaque so a new kind needs no schema change.
    options: dict = field(default_factory=dict)

    @property
    def label(self) -> str:
        return f"{self.kind}:{self.target}"


@dataclass(frozen=True)
class Reading:
    """What an observer made of one window.

    uptime and evidence are not optional. A count over footage full of gaps is
    not the same claim as a count over a whole window, and a result nobody can
    check afterwards is the thing this product exists not to publish.
    """

    count: int
    samples: list[dict]
    # Share of the window actually observed. Anything below the resolver's floor
    # is refused before consensus looks at it.
    uptime: float = 0.0
    evidence_root: str = ""
    detail: dict = field(default_factory=dict)


class Observer(Protocol):
    """Anything that can count one kind of claim.

    Two of these run per market and must agree, so an implementation has to be
    independently configurable: two copies of the same settings agree even when
    both are wrong.
    """

    kind: str

    def supports(self, claim: Claim) -> bool: ...

    def qualify(self, url: str, claim: Claim, seconds: float) -> tuple[bool, str]:
        """Whether this stream can support this claim at all."""

    def observe(self, url: str, claim: Claim, seconds: float, role: str) -> Reading: ...


_observers: dict[str, Observer] = {}


def register(observer: Observer) -> None:
    _observers[observer.kind] = observer


def observer_for(claim: Claim) -> Observer | None:
    observer = _observers.get(claim.kind)
    return observer if observer and observer.supports(claim) else None


def kinds() -> list[str]:
    return sorted(_observers)
