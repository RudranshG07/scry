import hashlib
import json
from datetime import datetime, timedelta
from typing import Any, Protocol

from .storage import EvidenceIntegrityError, EvidenceStoreError, StoredEvidence, create_stored_evidence


class S3Client(Protocol):
    def put_object(self, **kwargs: Any) -> Any: ...

    def get_object(self, **kwargs: Any) -> dict[str, Any]: ...

    def list_objects_v2(self, **kwargs: Any) -> dict[str, Any]: ...

    def delete_objects(self, **kwargs: Any) -> Any: ...


class S3EvidenceStore:
    def __init__(self, client: S3Client, bucket: str, kms_key_id: str, prefix: str = "scry-evidence") -> None:
        if not bucket or not kms_key_id:
            raise ValueError("S3 bucket and KMS key identity are required.")
        self.client = client
        self.bucket = bucket
        self.kms_key_id = kms_key_id
        self.prefix = prefix.strip("/")

    def _key(self, suffix: str) -> str:
        return f"{self.prefix}/{suffix}" if self.prefix else suffix

    def _object_key(self, digest: str) -> str:
        return self._key(f"objects/{digest[:2]}/{digest}")

    def _record_key(self, record_id: str) -> str:
        return self._key(f"records/{record_id}.json")

    def _put(self, key: str, content: bytes, media_type: str, metadata: dict[str, str]) -> None:
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=content,
            ContentType=media_type,
            ServerSideEncryption="aws:kms",
            SSEKMSKeyId=self.kms_key_id,
            Metadata=metadata,
        )

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
        self._put(
            self._object_key(record.digest),
            content,
            media_type,
            {"sha256": record.digest, "market-id": record.market_id},
        )
        record_content = json.dumps(record.to_document(), ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
        self._put(
            self._record_key(record.record_id),
            record_content,
            "application/json",
            {"sha256": hashlib.sha256(record_content).hexdigest(), "market-id": record.market_id},
        )
        return record

    def _body(self, response: dict[str, Any]) -> bytes:
        body = response.get("Body")
        if isinstance(body, bytes):
            return body
        if hasattr(body, "read"):
            content = body.read()
            if isinstance(content, bytes):
                return content
        raise EvidenceIntegrityError("S3 evidence response did not contain bytes.")

    def _get(self, key: str) -> bytes:
        try:
            return self._body(self.client.get_object(Bucket=self.bucket, Key=key))
        except EvidenceIntegrityError:
            raise
        except Exception as error:
            raise EvidenceStoreError("S3 evidence object was not found.") from error

    def _record(self, record_id: str) -> StoredEvidence:
        try:
            document = json.loads(self._get(self._record_key(record_id)))
            record = StoredEvidence.from_document(document)
        except EvidenceStoreError:
            raise
        except Exception as error:
            raise EvidenceIntegrityError("S3 evidence metadata could not be verified.") from error
        if record.record_id != record_id:
            raise EvidenceIntegrityError("S3 evidence metadata identity does not match its key.")
        return record

    def read(self, record_id: str) -> tuple[StoredEvidence, bytes]:
        record = self._record(record_id)
        content = self._get(self._object_key(record.digest))
        if len(content) != record.size_bytes or hashlib.sha256(content).hexdigest() != record.digest:
            raise EvidenceIntegrityError("S3 evidence object failed its integrity check.")
        return record, content

    def _keys(self, prefix: str) -> tuple[str, ...]:
        keys: list[str] = []
        token: str | None = None
        while True:
            request: dict[str, Any] = {"Bucket": self.bucket, "Prefix": self._key(prefix)}
            if token:
                request["ContinuationToken"] = token
            response = self.client.list_objects_v2(**request)
            keys.extend(item["Key"] for item in response.get("Contents", []))
            if not response.get("IsTruncated"):
                return tuple(keys)
            token = response.get("NextContinuationToken")
            if not token:
                raise EvidenceStoreError("S3 evidence listing ended without a continuation token.")

    def list_records(self, market_id: str | None = None) -> tuple[StoredEvidence, ...]:
        records = tuple(
            self._record(key.rsplit("/", 1)[-1].removesuffix(".json"))
            for key in sorted(self._keys("records/"))
        )
        return tuple(record for record in records if market_id is None or record.market_id == market_id)

    def _delete(self, keys: tuple[str, ...]) -> None:
        if not keys:
            return
        for index in range(0, len(keys), 1000):
            self.client.delete_objects(
                Bucket=self.bucket,
                Delete={"Objects": [{"Key": key} for key in keys[index:index + 1000]], "Quiet": True},
            )

    def purge_expired(self, as_of: datetime) -> tuple[str, ...]:
        if as_of.tzinfo is None:
            raise ValueError("Evidence purge time must include a timezone.")
        expired = tuple(record for record in self.list_records() if record.expired(as_of))
        self._delete(tuple(self._record_key(record.record_id) for record in expired))
        referenced = {record.digest for record in self.list_records()}
        unused = tuple(
            key for key in self._keys("objects/")
            if key.rsplit("/", 1)[-1] not in referenced
        )
        self._delete(unused)
        return tuple(record.record_id for record in expired)
