"""Signs a report so the API can tell which observer sent it.

personal_sign over the market and a digest of the exact body, with an Ethereum
key, so the address the API trusts for an observer is the same kind of address
ObserverRegistry holds on chain.
"""

from __future__ import annotations

import hashlib

from eth_hash.auto import keccak
from eth_keys import keys


def message_for(market: str, body: bytes) -> bytes:
    return f"scry-observation:{market}:{hashlib.sha256(body).hexdigest()}".encode()


def sign_report(key: str, market: str, body: bytes) -> str:
    message = message_for(market, body)
    digest = keccak(b"\x19Ethereum Signed Message:\n" + str(len(message)).encode() + message)
    signature = keys.PrivateKey(bytes.fromhex(key.removeprefix("0x"))).sign_msg_hash(digest)
    return "0x" + signature.to_bytes().hex()
