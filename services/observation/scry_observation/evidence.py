import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import fields, is_dataclass
from datetime import UTC, datetime
from enum import Enum
from typing import Any

from .models import EvidenceArtifact, EvidenceBundle, ObservationCommitment


def _canonical_value(value: Any) -> Any:
    if is_dataclass(value):
        return {
            field.name: _canonical_value(getattr(value, field.name))
            for field in fields(value)
        }
    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, Mapping):
        return {
            str(key): _canonical_value(item)
            for key, item in sorted(value.items(), key=lambda pair: str(pair[0]))
        }
    if isinstance(value, Sequence) and not isinstance(value, str | bytes | bytearray):
        return [_canonical_value(item) for item in value]
    return value


def canonical_json(value: Any) -> bytes:
    return json.dumps(
        _canonical_value(value),
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def create_artifact(name: str, media_type: str, content: bytes) -> EvidenceArtifact:
    return EvidenceArtifact(
        name=name,
        media_type=media_type,
        digest=hashlib.sha256(content).hexdigest(),
        size_bytes=len(content),
    )


def _leaf(content: bytes) -> bytes:
    return hashlib.sha256(b"\x00" + content).digest()


def _node(left: bytes, right: bytes) -> bytes:
    return hashlib.sha256(b"\x01" + left + right).digest()


def evidence_root(bundle: EvidenceBundle) -> str:
    metadata = {
        "schema_version": bundle.schema_version,
        "market_id": bundle.market_id,
        "stream_id": bundle.stream_id,
        "rule_hash": bundle.rule_hash,
        "window": bundle.window,
        "generated_at": bundle.generated_at,
        "decision": bundle.decision,
        "observer_results": bundle.observer_results,
    }
    leaves = [_leaf(canonical_json(metadata))]
    leaves.extend(
        _leaf(bytes.fromhex(artifact.digest))
        for artifact in sorted(bundle.artifacts, key=lambda artifact: artifact.name)
    )
    level = leaves
    while len(level) > 1:
        if len(level) % 2:
            level = [*level, level[-1]]
        level = [
            _node(level[index], level[index + 1])
            for index in range(0, len(level), 2)
        ]
    return f"0x{level[0].hex()}"


def build_commitment(bundle: EvidenceBundle) -> ObservationCommitment:
    root = evidence_root(bundle)
    payload = canonical_json(
        {
            "schemaVersion": bundle.schema_version,
            "marketId": bundle.market_id,
            "streamId": bundle.stream_id,
            "ruleHash": bundle.rule_hash,
            "observationStartsAt": bundle.window.starts_at,
            "observationEndsAt": bundle.window.ends_at,
            "status": bundle.decision.status,
            "observedValue": bundle.decision.observed_value,
            "winningOutcomeId": bundle.decision.winning_outcome_id,
            "agreeingObserverIds": bundle.decision.agreeing_observer_ids,
            "evidenceRoot": root,
        }
    )
    return ObservationCommitment(
        evidence_root=root,
        payload_digest=f"0x{hashlib.sha256(payload).hexdigest()}",
        payload=payload,
    )
