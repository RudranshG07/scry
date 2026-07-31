"""Builds the evidence bundle behind a report.

A count nobody can check is just a number an observer asserted. This turns the
working record into a merkle tree, so the root can be published with the result
and any single interval proved against it afterwards without republishing the
footage.

sha256 rather than keccak256: Solidity reaches sha256 through a precompile, so a
proof stays cheap to verify on chain, and it is in the Python standard library.
hashlib.sha3_256 is *not* keccak256 - the padding differs - so reaching for it
would produce roots the chain could never reproduce.
"""

from __future__ import annotations

import hashlib

# Leaves and internal nodes are hashed under different prefixes, so a leaf can
# never be replayed as a node. Without this an attacker can present an internal
# node as though it were a real interval and prove something that never
# happened. RFC 6962 does the same thing for certificate logs.
LEAF = b"\x00"
NODE = b"\x01"


def stamp(when) -> str:
    """Canonical timestamp for anything that gets hashed.

    datetime.isoformat() drops the microseconds when they happen to be zero, so
    the same instant can encode two different ways and hash to two different
    leaves. Fixed width always, or Go and Python quietly disagree about one
    interval in a million.
    """
    return when.strftime("%Y-%m-%dT%H:%M:%S.%f") + "Z"


def digest(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def chain(previous: str, payload: bytes) -> str:
    """Folds one frame into a running digest.

    Frames are hashed as a chain rather than kept individually: the bundle stays
    a fixed size however long the window runs, and because each step includes the
    one before it, a frame cannot be dropped, reordered or swapped without
    changing every digest after it.
    """
    return hashlib.sha256(previous.encode() + payload).hexdigest()


def leaf(sample: dict) -> bytes:
    """One counting interval, canonically encoded.

    Field order and separator are fixed so Python, Go and Solidity all hash the
    same bytes. Anything ambiguous here would produce roots that disagree across
    languages while looking correct in each.
    """
    fields = [
        sample["observedAt"],
        str(sample["count"]),
        str(sample["intervalSeconds"]),
        sample["modelVersion"],
        sample.get("frameDigest", ""),
    ]
    return hashlib.sha256(LEAF + "|".join(fields).encode()).digest()


def pair(a: bytes, b: bytes) -> bytes:
    """Hashes two nodes smallest first.

    Sorting means a proof carries only siblings and no left/right flags, which is
    the shape Solidity's MerkleProof already verifies. Both sides must sort
    identically or nothing built here will check out on chain.

    The trade is that the root fixes the set of intervals rather than their
    order. That costs nothing here because every leaf carries its own
    observedAt, so the timeline is read from the data rather than inferred from
    the shape of the tree.
    """
    left, right = (a, b) if a < b else (b, a)
    return hashlib.sha256(NODE + left + right).digest()


def root(leaves: list[bytes]) -> str:
    if not leaves:
        return ""

    level = list(leaves)
    while len(level) > 1:
        nxt = [pair(level[i], level[i + 1]) for i in range(0, len(level) - 1, 2)]
        # An unpaired node is carried up rather than hashed with itself.
        # Duplicating it lets two different sets of intervals produce the same
        # root, which is exactly what the root exists to rule out.
        if len(level) % 2:
            nxt.append(level[-1])
        level = nxt

    return "0x" + level[0].hex()


def path(leaves: list[bytes], index: int) -> list[str]:
    """Siblings needed to walk one leaf back up to the root."""
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
            # This node had no sibling at this level, so it rises untouched and
            # contributes nothing to the proof.
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
