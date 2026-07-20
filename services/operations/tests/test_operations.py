import json
import unittest
from datetime import UTC, datetime
from pathlib import Path

from scry_operations import AlertCode, OperationsPolicy, OperationalSnapshot, evaluate_operations, execute_operations


def snapshot(**updates) -> OperationalSnapshot:
    values = {
        "recorded_at": datetime(2026, 7, 20, 14, 20, tzinfo=UTC),
        "stream_id": "stream-1",
        "market_id": "market-1",
        "stream_uptime": 0.999,
        "timestamp_drift_ms": 120,
        "observer_values": (181, 182, 181),
        "evidence_available": True,
        "resolution_latency_seconds": 420,
        "index_lag_blocks": 2,
        "treasury_exposure_usdc": 2500,
        "invalid_market_rate": 0.01,
    }
    values.update(updates)
    return OperationalSnapshot(**values)


class OperationsTests(unittest.TestCase):
    def test_healthy_snapshot_has_no_alerts(self) -> None:
        self.assertEqual(evaluate_operations(snapshot()), ())

    def test_degraded_snapshot_emits_each_required_alert_class(self) -> None:
        alerts = evaluate_operations(
            snapshot(
                stream_uptime=0.9,
                timestamp_drift_ms=800,
                observer_values=(180, 195),
                evidence_available=False,
                resolution_latency_seconds=1000,
                index_lag_blocks=20,
                treasury_exposure_usdc=12000,
                invalid_market_rate=0.05,
            ),
            OperationsPolicy(),
        )
        self.assertEqual({alert.code for alert in alerts}, set(AlertCode))
        self.assertEqual(sum(alert.severity.value == "critical" for alert in alerts), 5)

    def test_alert_fingerprint_is_stable_for_the_same_resource_and_code(self) -> None:
        first = evaluate_operations(snapshot(stream_uptime=0.8))[0]
        second = evaluate_operations(snapshot(stream_uptime=0.7))[0]
        self.assertEqual(first.fingerprint, second.fingerprint)

    def test_fixture_pipeline_reports_critical_and_warning_counts(self) -> None:
        path = Path(__file__).parents[1] / "fixtures" / "degraded_market.json"
        output = execute_operations(json.loads(path.read_text(encoding="utf-8")))
        self.assertEqual(output["status"], "attention")
        self.assertEqual(output["criticalCount"], 5)
        self.assertEqual(output["warningCount"], 3)


if __name__ == "__main__":
    unittest.main()
