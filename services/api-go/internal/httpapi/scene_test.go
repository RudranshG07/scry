package httpapi

import "testing"

func TestSceneDriftCountsDifferingBits(t *testing.T) {
	if got := sceneDrift("ffffffffffffffff", "ffffffffffffffff"); got != 0 {
		t.Errorf("identical fingerprints drifted %d", got)
	}
	if got := sceneDrift("0000000000000000", "ffffffffffffffff"); got != 64 {
		t.Errorf("opposite fingerprints drifted %d, want 64", got)
	}
	if got := sceneDrift("0000000000000000", "0000000000000007"); got != 3 {
		t.Errorf("three differing bits reported %d", got)
	}
}

func TestAnUnreadableFingerprintIsNeverAMatch(t *testing.T) {
	// Silence must not pass for agreement: an observer that sends nothing, or
	// something that is not a fingerprint, has not shown it counted the right
	// scene.
	for _, reported := range []string{"", "not-hex", "zzzz", "ffffffffffffffffff"} {
		if !sceneChanged("95689182cb4fbc3b", reported) {
			t.Errorf("reported %q passed as the qualified scene", reported)
		}
	}
}

func TestTheSameViewSurvivesTrafficAndNightfall(t *testing.T) {
	// Measured on a synthetic road scene: cars appearing and a 55 level
	// brightness drop both moved the fingerprint by 0 bits, a pan by 34.
	qualified := "95689182cb4fbc3b"
	if sceneChanged(qualified, qualified) {
		t.Error("the same view was called a different scene")
	}
	if sceneChanged(qualified, "95689182cb4fbc3f") {
		t.Error("one differing bit was called a different scene")
	}
}

func TestACutToAnotherCameraIsRefused(t *testing.T) {
	if !sceneChanged("95689182cb4fbc3b", "6a976e7d34b043c4") {
		t.Error("an inverted fingerprint passed as the same scene")
	}
}

func TestAStreamQualifiedBeforeFingerprintsIsNotPenalised(t *testing.T) {
	// Every market on those streams would otherwise void for a check that was
	// not running when they were qualified.
	if sceneChanged("", "95689182cb4fbc3b") {
		t.Error("a stream with no recorded scene had its market voided")
	}
}
