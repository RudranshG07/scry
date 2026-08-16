package httpapi

import (
	"context"
	"math/bits"
	"strconv"
)

// How far a scene fingerprint may drift and still be the same view. Kept in
// step with MAX_DRIFT in scry_vision/scene.py, which carries the measurements:
// the same view fingerprints identically within a session, drifts about 18 bits
// across three hours of daylight, and lands at 30 or more once the camera has
// actually moved. The gap is narrow and holds only because inspection re-bases
// the fingerprint every six hours.
const maxSceneDrift = 24

// QualifiedScenes reports the view each stream was qualified on.
type QualifiedScenes interface {
	SceneForMarket(context.Context, string) (string, error)
}

// sceneDrift is the Hamming distance between two 64 bit fingerprints. An
// unreadable or missing fingerprint is treated as maximally distant so it can
// never quietly pass for a match.
func sceneDrift(a, b string) int {
	if a == "" || b == "" {
		return 64
	}
	left, err := strconv.ParseUint(a, 16, 64)
	if err != nil {
		return 64
	}
	right, err := strconv.ParseUint(b, 16, 64)
	if err != nil {
		return 64
	}
	return bits.OnesCount64(left ^ right)
}

// sceneChanged says whether a count was taken on the view the stream was
// qualified on.
//
// Checked here rather than in the observer because this is the one fault the
// quorum cannot catch: when a feed cuts to another camera, both observers see
// the identical wrong scene and agree perfectly. Sukhumvit Soi 11 settled a
// market at 4 crossings during rush hour that way, full uptime, both observers
// within one of each other.
func sceneChanged(qualified, reported string) bool {
	if qualified == "" {
		// Nothing to compare against: streams qualified before fingerprints were
		// recorded would otherwise have every market voided.
		return false
	}
	return sceneDrift(qualified, reported) > maxSceneDrift
}
