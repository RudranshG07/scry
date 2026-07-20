import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory

from scry_observation import EvidenceIntegrityError, FileEvidenceStore


def instant(second: int = 0) -> datetime:
    return datetime(2026, 7, 20, 14, 0, second, tzinfo=UTC)


class FileEvidenceStoreTests(unittest.TestCase):
    def test_round_trip_returns_verified_content_and_artifact(self) -> None:
        with TemporaryDirectory() as directory:
            store = FileEvidenceStore(directory)
            saved = store.put(
                "market-1",
                "timeline.json",
                "application/json",
                b'{"count":182}',
                instant(),
                timedelta(days=7),
            )
            record, content = store.read(saved.record_id)
            self.assertEqual(record, saved)
            self.assertEqual(content, b'{"count":182}')
            self.assertEqual(record.artifact.digest, saved.digest)

    def test_tampered_content_fails_integrity_check(self) -> None:
        with TemporaryDirectory() as directory:
            store = FileEvidenceStore(directory)
            saved = store.put(
                "market-1",
                "timeline.json",
                "application/json",
                b"original",
                instant(),
                timedelta(days=7),
            )
            object_path = Path(directory) / "objects" / saved.digest[:2] / saved.digest
            object_path.write_bytes(b"tampered")
            with self.assertRaises(EvidenceIntegrityError):
                store.read(saved.record_id)

    def test_retention_purge_preserves_objects_with_live_records(self) -> None:
        with TemporaryDirectory() as directory:
            store = FileEvidenceStore(directory)
            expired = store.put(
                "market-1",
                "timeline.json",
                "application/json",
                b"shared",
                instant(),
                timedelta(seconds=1),
            )
            live = store.put(
                "market-2",
                "timeline.json",
                "application/json",
                b"shared",
                instant(1),
                timedelta(days=7),
            )
            removed = store.purge_expired(instant(2))
            self.assertEqual(removed, (expired.record_id,))
            self.assertEqual(store.read(live.record_id)[1], b"shared")

    def test_path_traversal_identifiers_are_rejected(self) -> None:
        with TemporaryDirectory() as directory:
            store = FileEvidenceStore(directory)
            with self.assertRaises(ValueError):
                store.put(
                    "../market",
                    "timeline.json",
                    "application/json",
                    b"content",
                    instant(),
                    timedelta(days=1),
                )


if __name__ == "__main__":
    unittest.main()
