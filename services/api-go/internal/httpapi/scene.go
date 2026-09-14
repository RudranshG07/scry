package httpapi

import (
	"context"
	"math/bits"
	"strconv"
)

const maxSceneDrift = 24

type QualifiedScenes interface {
	SceneForMarket(context.Context, string) (string, error)
}

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

func sceneChanged(qualified, reported string) bool {
	if qualified == "" {
		return false
	}
	return sceneDrift(qualified, reported) > maxSceneDrift
}
