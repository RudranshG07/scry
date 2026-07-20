import unittest
from datetime import UTC, datetime, timedelta
from io import BytesIO

from scry_observation import EvidenceIntegrityError, S3EvidenceStore


class MemoryS3:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.put_requests: list[dict] = []

    def put_object(self, **kwargs):
        self.objects[kwargs["Key"]] = kwargs["Body"]
        self.put_requests.append(kwargs)

    def get_object(self, **kwargs):
        return {"Body": BytesIO(self.objects[kwargs["Key"]])}

    def list_objects_v2(self, **kwargs):
        keys = sorted(key for key in self.objects if key.startswith(kwargs["Prefix"]))
        return {"Contents": [{"Key": key} for key in keys], "IsTruncated": False}

    def delete_objects(self, **kwargs):
        for item in kwargs["Delete"]["Objects"]:
            self.objects.pop(item["Key"], None)


def instant(second: int = 0) -> datetime:
    return datetime(2026, 7, 21, 11, 0, second, tzinfo=UTC)


class S3EvidenceStoreTests(unittest.TestCase):
    def test_round_trip_requires_kms_for_content_and_metadata(self) -> None:
        client = MemoryS3()
        store = S3EvidenceStore(client, "evidence-bucket", "kms-key-1")
        saved = store.put("market-1", "timeline.json", "application/json", b"timeline", instant(), timedelta(days=7))
        record, content = store.read(saved.record_id)
        self.assertEqual(record, saved)
        self.assertEqual(content, b"timeline")
        self.assertEqual(len(client.put_requests), 2)
        self.assertTrue(all(request["ServerSideEncryption"] == "aws:kms" for request in client.put_requests))
        self.assertTrue(all(request["SSEKMSKeyId"] == "kms-key-1" for request in client.put_requests))

    def test_tampered_s3_content_fails_integrity_check(self) -> None:
        client = MemoryS3()
        store = S3EvidenceStore(client, "evidence-bucket", "kms-key-1")
        saved = store.put("market-1", "timeline.json", "application/json", b"timeline", instant(), timedelta(days=7))
        client.objects[f"scry-evidence/objects/{saved.digest[:2]}/{saved.digest}"] = b"tampered"
        with self.assertRaises(EvidenceIntegrityError):
            store.read(saved.record_id)

    def test_retention_preserves_shared_objects_with_live_records(self) -> None:
        client = MemoryS3()
        store = S3EvidenceStore(client, "evidence-bucket", "kms-key-1")
        expired = store.put("market-1", "timeline.json", "application/json", b"shared", instant(), timedelta(seconds=1))
        live = store.put("market-2", "timeline.json", "application/json", b"shared", instant(1), timedelta(days=7))
        self.assertEqual(store.purge_expired(instant(2)), (expired.record_id,))
        self.assertEqual(store.read(live.record_id)[1], b"shared")

    def test_bucket_and_kms_key_are_required(self) -> None:
        with self.assertRaises(ValueError):
            S3EvidenceStore(MemoryS3(), "", "kms-key-1")
        with self.assertRaises(ValueError):
            S3EvidenceStore(MemoryS3(), "evidence-bucket", "")


if __name__ == "__main__":
    unittest.main()
