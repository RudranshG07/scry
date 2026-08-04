"""Merkle bundle behind a report, so any interval can be proved against the
published root without republishing the footage.

sha256, not keccak256: Solidity reaches sha256 through a precompile and it is in
the standard library. hashlib.sha3_256 is not keccak256; the padding differs.
"""

from __future__ import annotations

import hashlib

# RFC 6962 domain separation, so a leaf cannot be replayed as an internal node.
LEAF = b"\x00"
NODE = b"\x01"


def stamp(when) -> str:
    """Fixed-width, because isoformat() drops zero microseconds and the same
    instant would then hash two different ways across languages."""
    return when.strftime("%Y-%m-%dT%H:%M:%S.%f") + "Z"


def digest(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def chain(previous: str, payload: bytes) -> str:
    """Folds a frame into a running digest, so the bundle stays fixed size and no
    frame can be dropped or reordered without changing every digest after it."""
    return hashlib.sha256(previous.encode() + payload).hexdigest()


def leaf(sample: dict) -> bytes:
    """One interval, canonically encoded. Field order and separator are fixed so
    Python, Go and Solidity hash the same bytes."""
    fields = [
        sample["observedAt"],
        str(sample["count"]),
        str(sample["intervalSeconds"]),
        sample["modelVersion"],
        sample.get("frameDigest", ""),
    ]
    return hashlib.sha256(LEAF + "|".join(fields).encode()).digest()


def pair(a: bytes, b: bytes) -> bytes:
    """Smallest first, matching Solidity's MerkleProof so a proof carries only
    siblings. The root then fixes the set of intervals, not their order, which
    costs nothing because every leaf carries its own observedAt."""
    left, right = (a, b) if a < b else (b, a)
    return hashlib.sha256(NODE + left + right).digest()


def root(leaves: list[bytes]) -> str:
    if not leaves:
        return ""

    level = list(leaves)
    while len(level) > 1:
        nxt = [pair(level[i], level[i + 1]) for i in range(0, len(level) - 1, 2)]
        # Carried up, not hashed with itself: duplicating lets two different
        # interval sets reach the same root.
        if len(level) % 2:
            nxt.append(level[-1])
        level = nxt

    return "0x" + level[0].hex()


def path(leaves: list[bytes], index: int) -> list[str]:
    """Siblings needed to walk one leaf up to the root."""
    if not leaves or index < 0 or index >= len(leaves):
        return []

    out: list[str] = []
    level = list(leaves)
    at = index

    while len(level) > 1:
        odd = len(level) % 2 == 1
        carried = odd and at == len(level) - 1

        nxt = [pair(level[i], level[i + 1]) for i in range(0, len(level) - 1, 2)]
        if odd:
            nxt.append(level[-1])

        if carried:
            at = len(nxt) - 1
        else:
            out.append(level[at ^ 1].hex())
            at //= 2

        level = nxt

    return out


def verify(one: bytes, proof: list[str], expected: str) -> bool:
    running = one
    for sibling in proof:
        running = pair(running, bytes.fromhex(sibling))
    return "0x" + running.hex() == expected


def bundle(samples: list[dict]) -> tuple[str, list[bytes]]:
    leaves = [leaf(s) for s in samples]
    return root(leaves), leaves
