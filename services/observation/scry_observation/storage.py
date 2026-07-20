import hashlib
import json
import os
import re
import tempfile
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Protocol

from .models import EvidenceArtifact


class EvidenceStoreError(RuntimeError):
    pass


class EvidenceIntegrityError(EvidenceStoreError):
    pass


@dataclass(frozen=True, slots=True)
class StoredEvidence:
    record_id: str
    market_id: str
    name: str
    media_type: str
    digest: str
    size_bytes: int
    created_at: datetime
    expires_at: datetime

    def __post_init__(self) -> None:
        if self.created_at.tzinfo is None or self.expires_at.tzinfo is None:
            raise ValueError("Evidence timestamps must include a timezone.")
        if self.expires_at <= self.created_at:
            raise ValueError("Evidence expiry must follow creation time.")
        if len(self.digest) != 64 or any(character not in "0123456789abcdef" for character in self.digest):
            raise ValueError("Evidence digest must be lowercase SHA-256 hex.")
        if self.size_bytes < 0:
            raise ValueError("Evidence size cannot be negative.")

    @property
    def artifact(self) -> EvidenceArtifact:
        return EvidenceArtifact(self.name, self.media_type, self.digest, self.size_bytes)

    def expired(self, as_of: datetime) -> bool:
        if as_of.tzinfo is None:
            raise ValueError("Expiry checks require a timezone.")
        return as_of >= self.expires_at

    def to_document(self) -> dict[str, str | int]:
        return {
            "recordId": self.record_id,
            "marketId": self.market_id,
            "name": self.name,
            "mediaType": self.media_type,
            "digest": self.digest,
            "sizeBytes": self.size_bytes,
            "createdAt": _timestamp(self.created_at),
            "expiresAt": _timestamp(self.expires_at),
        }

    @classmethod
    def from_document(cls, document: dict[str, str | int]) -> "StoredEvidence":
        return cls(
            record_id=str(document["recordId"]),
            market_id=str(document["marketId"]),
            name=str(document["name"]),
            media_type=str(document["mediaType"]),
            digest=str(document["digest"]),
            size_bytes=int(document["sizeBytes"]),
            created_at=_parse_timestamp(str(document["createdAt"])),
            expires_at=_parse_timestamp(str(document["expiresAt"])),
        )


class EvidenceStore(Protocol):
    def put(
        self,
        market_id: str,
        name: str,
        media_type: str,
        content: bytes,
        created_at: datetime,
        retention: timedelta,
    ) -> StoredEvidence: ...

    def read(self, record_id: str) -> tuple[StoredEvidence, bytes]: ...

    def list_records(self, market_id: str | None = None) -> tuple[StoredEvidence, ...]: ...

    def purge_expired(self, as_of: datetime) -> tuple[str, ...]: ...


def _timestamp(value: datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _parse_timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _segment(value: str, label: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", value):
        raise ValueError(f"{label} contains unsupported characters.")
    return value


def create_stored_evidence(
    market_id: str,
    name: str,
    media_type: str,
    content: bytes,
    created_at: datetime,
    retention: timedelta,
) -> StoredEvidence:
    _segment(market_id, "Market identity")
    _segment(name, "Evidence name")
    if not media_type.strip():
        raise ValueError("Evidence media type is required.")
    if created_at.tzinfo is None:
        raise ValueError("Evidence creation time must include a timezone.")
    if retention <= timedelta(0):
        raise ValueError("Evidence retention must be positive.")
    digest = hashlib.sha256(content).hexdigest()
    identity = json.dumps(
        [market_id, name, digest, _timestamp(created_at)],
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return StoredEvidence(
        record_id=hashlib.sha256(identity).hexdigest(),
        market_id=market_id,
        name=name,
        media_type=media_type,
        digest=digest,
        size_bytes=len(content),
        created_at=created_at,
        expires_at=created_at + retention,
    )


class FileEvidenceStore:
    def __init__(self, root: str | Path) -> None:
        self.root = Path(root).resolve()
        self.objects = self.root / "objects"
        self.records = self.root / "records"
        self.objects.mkdir(parents=True, exist_ok=True)
        self.records.mkdir(parents=True, exist_ok=True)

    def _object_path(self, digest: str) -> Path:
        return self.objects / digest[:2] / digest

    def _record_path(self, record_id: str) -> Path:
        return self.records / f"{_segment(record_id, 'Record identity')}.json"

    def _atomic_write(self, target: Path, content: bytes) -> None:
        target.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary = tempfile.mkstemp(prefix=".scry-", dir=target.parent)
        try:
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, target)
        except Exception:
            Path(temporary).unlink(missing_ok=True)
            raise

    def put(
        self,
        market_id: str,
        name: str,
        media_type: str,
        content: bytes,
        created_at: datetime,
        retention: timedelta,
    ) -> StoredEvidence:
        record = create_stored_evidence(market_id, name, media_type, content, created_at, retention)
        object_path = self._object_path(record.digest)
        if object_path.exists():
            existing = object_path.read_bytes()
            if hashlib.sha256(existing).hexdigest() != record.digest:
                raise EvidenceIntegrityError("Stored evidence object failed its integrity check.")
        else:
            self._atomic_write(object_path, content)
        self._atomic_write(
            self._record_path(record.record_id),
            json.dumps(record.to_document(), ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8"),
        )
        return record

    def _load_record(self, path: Path) -> StoredEvidence:
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
            record = StoredEvidence.from_document(document)
        except Exception as error:
            raise EvidenceIntegrityError("Evidence metadata could not be verified.") from error
        if path != self._record_path(record.record_id):
            raise EvidenceIntegrityError("Evidence metadata identity does not match its record path.")
        return record

    def read(self, record_id: str) -> tuple[StoredEvidence, bytes]:
        path = self._record_path(record_id)
        if not path.exists():
            raise EvidenceStoreError("Evidence record was not found.")
        record = self._load_record(path)
        object_path = self._object_path(record.digest)
        if not object_path.exists():
            raise EvidenceIntegrityError("Evidence object is unavailable.")
        content = object_path.read_bytes()
        if len(content) != record.size_bytes or hashlib.sha256(content).hexdigest() != record.digest:
            raise EvidenceIntegrityError("Evidence object failed its integrity check.")
        return record, content

    def list_records(self, market_id: str | None = None) -> tuple[StoredEvidence, ...]:
        if market_id is not None:
            _segment(market_id, "Market identity")
        records = tuple(
            self._load_record(path)
            for path in sorted(self.records.glob("*.json"))
        )
        return tuple(record for record in records if market_id is None or record.market_id == market_id)

    def purge_expired(self, as_of: datetime) -> tuple[str, ...]:
        if as_of.tzinfo is None:
            raise ValueError("Evidence purge time must include a timezone.")
        expired = tuple(record for record in self.list_records() if record.expired(as_of))
        for record in expired:
            self._record_path(record.record_id).unlink(missing_ok=True)
        referenced = {record.digest for record in self.list_records()}
        for object_path in self.objects.glob("*/*"):
            if object_path.is_file() and object_path.name not in referenced:
                object_path.unlink()
        return tuple(record.record_id for record in expired)
