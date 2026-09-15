"""Signs the result a market settles on, once this observer has checked it.

The engine proposes one result per market from both observers' reports, and
before it goes on chain each observer signs it. An observer signs only what its
own count supports: a value within the settlement tolerance of what it
reported, under the outcomes the market committed to before it opened. Anything
else is left unsigned, the resolver never sees it, and the market voids, which
refunds every stake rather than paying out on a number nobody here counted.
"""

from __future__ import annotations

import hashlib
import json
import math
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from eth_hash.auto import keccak
from eth_keys import keys

# resolve.go's tolerancePercent and toleranceFloor. Both observers must read the
# settlement bar the way the engine does, or one of them refuses a result the
# engine was right to propose.
TOLERANCE_PERCENT = 0.20
TOLERANCE_FLOOR = 2

DOMAIN_TYPE = keccak(b"EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
RESULT_TYPE = keccak(b"ObservationResult(bytes32 marketId,uint256 observedValue,bytes32 winningOutcomeId,"
                     b"bytes32 evidenceRoot,bytes32 ruleHash,uint64 observedAt)")

# How long a count is kept for signing. Results are proposed a minute after a
# window closes and voided twenty minutes after that if they are not signed.
KEEP_SECONDS = 2 * 24 * 3600


def allowed_spread(base: int) -> int:
    return max(TOLERANCE_FLOOR, math.ceil(base * TOLERANCE_PERCENT))


def rule_hash(market_id: str, threshold: int, ends_at: int) -> str:
    """schedule.go's ruleHash: what a market committed to before it opened."""
    return "0x" + hashlib.sha256(f"{market_id}|{threshold}|{ends_at}".encode()).hexdigest()


def _word(value: int) -> bytes:
    return value.to_bytes(32, "big")


def _bytes32(text: str) -> bytes:
    raw = bytes.fromhex(text.removeprefix("0x"))
    if len(raw) != 32:
        raise ValueError(f"want 32 bytes, got {len(raw)}")
    return raw


def _text32(text: str) -> bytes:
    raw = text.encode()
    if len(raw) > 32:
        raise ValueError(f"{text!r} is longer than 32 bytes")
    return raw.ljust(32, b"\0")


def _address(text: str) -> bytes:
    raw = bytes.fromhex(text.removeprefix("0x"))
    if len(raw) != 20:
        raise ValueError(f"not an address: {text}")
    return raw.rjust(32, b"\0")


def digest(settlement: dict) -> bytes:
    """The EIP-712 hash ObservationResolver.digest computes for this result."""
    domain = keccak(DOMAIN_TYPE + keccak(b"Scry") + keccak(b"1")
                    + _word(settlement["chainId"]) + _address(settlement["resolver"]))
    root = _bytes32(settlement["evidenceRoot"]) if settlement.get("evidenceRoot") else bytes(32)
    result = keccak(RESULT_TYPE
                    + keccak(settlement["marketId"].encode())
                    + _word(settlement["observedValue"])
                    + _text32(settlement["winningOutcomeId"])
                    + root
                    + _bytes32(settlement["ruleHash"])
                    + _word(settlement["observedAt"]))
    return keccak(b"\x19\x01" + domain + result)


def objection(settlement: dict, mine: int | None) -> str | None:
    """Why this observer will not sign, or None when its own count supports it."""
    if mine is None:
        return "there is no clean count of this window here"

    value = settlement["observedValue"]
    if abs(value - mine) > allowed_spread(min(value, mine)):
        return f"counted {mine}, the result says {value}"

    bands = {band["id"]: band for band in settlement.get("outcomes", [])}
    if set(bands) != {"yes", "no"}:
        return "not a threshold market this observer knows how to check"
    yes, no = bands["yes"], bands["no"]
    if (no["maximum"] is None or no["minimum"] is not None or yes["maximum"] is not None
            or yes["minimum"] != no["maximum"] + 1):
        return "not a threshold market this observer knows how to check"

    # The bands arrive from the API, which is not to be trusted on them. The
    # rule hash is: it went on chain when the market was deployed.
    threshold = no["maximum"]
    if rule_hash(settlement["marketId"], threshold, settlement["observedAt"]) != settlement["ruleHash"].lower():
        return "these outcomes are not the ones the market committed to"

    winner = "yes" if value > threshold else "no"
    if settlement["winningOutcomeId"] != winner:
        return f"{value} against {threshold} is {winner}, not {settlement['winningOutcomeId']}"
    return None


def sign(key: str, message: bytes) -> str:
    """r, s and v as 27 or 28, which is what the resolver's ecrecover takes."""
    raw = keys.PrivateKey(bytes.fromhex(key.removeprefix("0x"))).sign_msg_hash(message).to_bytes()
    return "0x" + (raw[:64] + bytes([raw[64] + 27])).hex()


class Ledger:
    """What this observer reported, kept on disk so that a restart between
    reporting and signing does not leave a result it counted unsigned."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.Lock()

    @classmethod
    def for_observer(cls, observer: str, directory: str | None = None) -> Ledger:
        base = Path(directory) if directory else Path.home() / ".scry"
        return cls(base / f"{observer}-counts.json")

    def _read(self) -> dict:
        try:
            return json.loads(self.path.read_text())
        except (OSError, ValueError):
            return {}

    def record(self, market_id: str, count: int, now: float | None = None) -> None:
        now = time.time() if now is None else now
        with self._lock:
            entries = {market: entry for market, entry in self._read().items()
                       if now - entry.get("at", 0) < KEEP_SECONDS}
            entries[market_id] = {"count": int(count), "at": now}
            self.path.parent.mkdir(parents=True, exist_ok=True)
            partial = self.path.with_suffix(".partial")
            partial.write_text(json.dumps(entries))
            partial.replace(self.path)

    def count(self, market_id: str) -> int | None:
        with self._lock:
            entry = self._read().get(market_id)
        return None if entry is None else int(entry["count"])


def attest(api: str, observer: str, key: str, ledger: Ledger, refused: set | None = None) -> int:
    """Signs every settlement waiting on this observer that its count supports."""
    base = api.rstrip("/")
    refused = set() if refused is None else refused
    name = urllib.parse.quote(observer, safe="")
    with urllib.request.urlopen(f"{base}/v1/observers/{name}/settlements", timeout=15) as response:
        pending = json.loads(response.read())

    signed = 0
    for settlement in pending:
        where = (settlement["marketId"], settlement["chainId"])
        reason = objection(settlement, ledger.count(settlement["marketId"]))
        message = digest(settlement)
        if reason is None and "0x" + message.hex() != settlement.get("digest"):
            reason = f"the API hashes this result as {settlement.get('digest')}, not 0x{message.hex()}"
        if reason:
            if where not in refused:
                refused.add(where)
                print(f"not signing {where[0]} on chain {where[1]}: {reason}", flush=True)
            continue

        body = json.dumps({"observerId": observer, "chainId": settlement["chainId"],
                           "signature": sign(key, message)}).encode()
        request = urllib.request.Request(
            f"{base}/v1/markets/{urllib.parse.quote(settlement['marketId'], safe='')}/attestations",
            data=body, method="POST", headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                if response.status == 202:
                    signed += 1
                    print(f"signed {where[0]} on chain {where[1]}", flush=True)
        except urllib.error.HTTPError as error:
            print(f"signature for {where[0]} on chain {where[1]} refused: "
                  f"{error.code} {error.read().decode()}", file=sys.stderr, flush=True)
    return signed


def keep_attesting(api: str, observer: str, key: str, ledger: Ledger, every: float = 10.0) -> None:
    refused: set = set()
    while True:
        try:
            attest(api, observer, key, ledger, refused)
        except Exception as error:  # a restarting API should not stop signing for good
            print(f"attestation pass failed: {error}", file=sys.stderr, flush=True)
        time.sleep(every)


def start(api: str, observer: str, key: str, ledger: Ledger) -> threading.Thread:
    """Signs in the background. Counting a window blocks for minutes at a time,
    and a result waiting on this observer for that long is a result whose
    winners wait for it too."""
    thread = threading.Thread(target=keep_attesting, args=(api, observer, key, ledger),
                              name="attest", daemon=True)
    thread.start()
    return thread
