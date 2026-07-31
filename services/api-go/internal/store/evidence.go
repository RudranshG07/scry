package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/RudranshG07/scry/services/api-go/internal/domain"
)

// The observer hashes leaves under one prefix and internal nodes under another,
// so a leaf can never be replayed as a node. These have to stay identical to
// scry_vision/evidence.py or the roots will not agree.
var (
	leafPrefix = []byte{0x00}
	nodePrefix = []byte{0x01}
)

// GetEvidence returns one observer's intervals with the proof each needs to be
// checked against the published root. It is the difference between a result you
// are asked to trust and one you can take apart.
func (s *Postgres) GetEvidence(ctx context.Context, marketID, observerID string) (domain.EvidenceBundle, error) {
	var b domain.EvidenceBundle
	b.MarketID, b.ObserverID = marketID, observerID

	err := s.pool.QueryRow(ctx, `
		SELECT evidence_root FROM observer_reports
		WHERE market_id = $1 AND observer_id = $2`, marketID, observerID).Scan(&b.Root)
	if err == pgx.ErrNoRows {
		return b, ErrNotFound
	}
	if err != nil {
		return b, fmt.Errorf("read evidence root: %w", err)
	}

	rows, err := s.pool.Query(ctx, `
		SELECT leaf_index, observed_at, event_count, interval_seconds,
		       stream_quality, model_version, frame_digest
		FROM observation_samples
		WHERE market_id = $1 AND observer_id = $2
		ORDER BY leaf_index`, marketID, observerID)
	if err != nil {
		return b, fmt.Errorf("read samples: %w", err)
	}
	defer rows.Close()

	var leaves [][]byte
	for rows.Next() {
		var s domain.EvidenceSample
		var index int
		if err := rows.Scan(&index, &s.ObservedAt, &s.Count, &s.IntervalSeconds,
			&s.Quality, &s.ModelVersion, &s.FrameDigest); err != nil {
			return b, err
		}
		b.Samples = append(b.Samples, s)
		leaves = append(leaves, leafFor(s))
	}
	if err := rows.Err(); err != nil {
		return b, err
	}

	for i := range b.Samples {
		b.Samples[i].Proof = pathTo(leaves, i)
	}
	b.Recomputed = rootOf(leaves)
	return b, nil
}

func leafFor(s domain.EvidenceSample) []byte {
	// Field order and separator must match evidence.py exactly. Anything
	// ambiguous here produces roots that disagree across languages while looking
	// correct in both.
	encoded := fmt.Sprintf("%s|%d|%d|%s|%s",
		s.ObservedAt.UTC().Format("2006-01-02T15:04:05.000000Z"),
		s.Count, s.IntervalSeconds, s.ModelVersion, s.FrameDigest)
	sum := sha256.Sum256(append(leafPrefix, []byte(encoded)...))
	return sum[:]
}

// pair hashes two nodes smallest first, so a proof carries only siblings and no
// left/right flags.
func pair(a, b []byte) []byte {
	left, right := a, b
	if string(b) < string(a) {
		left, right = b, a
	}
	joined := append(append(append([]byte{}, nodePrefix...), left...), right...)
	sum := sha256.Sum256(joined)
	return sum[:]
}

func rootOf(leaves [][]byte) string {
	if len(leaves) == 0 {
		return ""
	}
	level := leaves
	for len(level) > 1 {
		var next [][]byte
		for i := 0; i+1 < len(level); i += 2 {
			next = append(next, pair(level[i], level[i+1]))
		}
		// An unpaired node rises untouched. Hashing it with itself would let two
		// different sets of intervals reach the same root.
		if len(level)%2 == 1 {
			next = append(next, level[len(level)-1])
		}
		level = next
	}
	return "0x" + hex.EncodeToString(level[0])
}

func pathTo(leaves [][]byte, index int) []string {
	if index < 0 || index >= len(leaves) {
		return nil
	}

	out := []string{}
	level := leaves
	at := index

	for len(level) > 1 {
		odd := len(level)%2 == 1
		carried := odd && at == len(level)-1

		var next [][]byte
		for i := 0; i+1 < len(level); i += 2 {
			next = append(next, pair(level[i], level[i+1]))
		}
		if odd {
			next = append(next, level[len(level)-1])
		}

		if carried {
			at = len(next) - 1
		} else {
			out = append(out, hex.EncodeToString(level[at^1]))
			at /= 2
		}
		level = next
	}
	return out
}
