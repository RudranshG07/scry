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
	for _, reported := range []string{"", "not-hex", "zzzz", "ffffffffffffffffff"} {
		if !sceneChanged("95689182cb4fbc3b", reported) {
			t.Errorf("reported %q passed as the qualified scene", reported)
		}
	}
}

func TestTheSameViewSurvivesTrafficAndNightfall(t *testing.T) {
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
	if sceneChanged("", "95689182cb4fbc3b") {
		t.Error("a stream with no recorded scene had its market voided")
	}
}

func TestTheBarClearsMeasuredNoiseAndCatchesAMove(t *testing.T) {
	if maxSceneDrift <= 12 {
		t.Errorf("maxSceneDrift = %d sits inside the noise a still camera makes", maxSceneDrift)
	}
	if maxSceneDrift >= 30 {
		t.Errorf("maxSceneDrift = %d would let a camera that moved pass", maxSceneDrift)
	}
}
