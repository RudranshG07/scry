package domain

import "time"

const ObserversRequired = 2

type Claim struct {
	Kind    string         `json:"kind"`
	Target  string         `json:"target"`
	Options map[string]any `json:"options,omitempty"`
}

func (c Claim) Label() string { return c.Kind + ":" + c.Target }

type MarketOutcome struct {
	ID          string  `json:"id"`
	Label       string  `json:"label"`
	Probability float64 `json:"probability"`
	ReturnRate  float64 `json:"returnRate"`
}

type Market struct {
	ID                  string          `json:"id"`
	StreamID            string          `json:"streamId"`
	Category            string          `json:"category"`
	Unit                string          `json:"unit"`
	Location            string          `json:"location"`
	City                string          `json:"city"`
	Question            string          `json:"question"`
	Status              string          `json:"status"`
	Countdown           string          `json:"countdown"`
	Pool                float64         `json:"pool"`
	CurrentRate         float64         `json:"currentRate"`
	Baseline            float64         `json:"baseline"`
	Observers           int             `json:"observers"`
	ObserversRequired   int             `json:"observersRequired"`
	Claim               Claim           `json:"claim"`
	Deployments         []Deployment    `json:"deployments"`
	OpensAt             string          `json:"opensAt"`
	LocksAt             string          `json:"locksAt"`
	ObservationStartsAt string          `json:"observationStartsAt"`
	ObservationEndsAt   string          `json:"observationEndsAt"`
	ResolvedAt          *string         `json:"resolvedAt,omitempty"`
	ObservedValue       *int64          `json:"observedValue,omitempty"`
	WinningOutcomeID    *string         `json:"winningOutcomeId,omitempty"`
	Outcomes            []MarketOutcome `json:"outcomes"`
	Trend               []float64       `json:"trend"`
}

// Deployment is a market's contract on one chain. A market is deployed to a
// chain when somebody first wants to take a position there.
type Deployment struct {
	ChainID         int64   `json:"chainId"`
	ContractAddress *string `json:"contractAddress,omitempty"`
	State           string  `json:"state"`
}

type OutcomeBand struct {
	ID      string `json:"id"`
	Minimum *int64 `json:"minimum"`
	Maximum *int64 `json:"maximum"`
}

// Settlement is the result one deployment settles on, as its observers are
// asked to sign it.
type Settlement struct {
	MarketID         string        `json:"marketId"`
	ChainID          int64         `json:"chainId"`
	ContractAddress  string        `json:"contractAddress"`
	Resolver         string        `json:"resolver"`
	ObservedValue    int64         `json:"observedValue"`
	WinningOutcomeID string        `json:"winningOutcomeId"`
	EvidenceRoot     string        `json:"evidenceRoot"`
	RuleHash         string        `json:"ruleHash"`
	ObservedAt       int64         `json:"observedAt"`
	Outcomes         []OutcomeBand `json:"outcomes"`
	Digest           string        `json:"digest"`
}

type Attestation struct {
	ObserverID string `json:"observerId"`
	ChainID    int64  `json:"chainId"`
	Signature  string `json:"signature"`
}

type StreamSource struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Region    string `json:"region"`
	Timezone  string `json:"timezone"`
	SourceURL string `json:"sourceUrl"`
	Status    string `json:"status"`
	Claim     Claim  `json:"claim"`
}

type StreamSubmission struct {
	SourceURL string `json:"sourceUrl"`
	Name      string `json:"name"`
	Region    string `json:"region"`
	Timezone  string `json:"timezone"`
	Category  string `json:"category"`
	Claim     Claim  `json:"claim"`
}

type Qualification struct {
	Usable       bool    `json:"usable"`
	Reason       string  `json:"reason"`
	Counts       string  `json:"counts"`
	Subjects     float64 `json:"subjects"`
	Peak         int     `json:"peak"`
	Disagreement float64 `json:"disagreement"`
	Provisional  bool    `json:"provisional"`
	Threshold    int     `json:"threshold"`
	Scene        string  `json:"scene"`
}

type Observer struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	Role         string  `json:"role"`
	State        string  `json:"state"`
	ModelVersion string  `json:"modelVersion"`
	Signature    *string `json:"signature,omitempty"`
	EvidenceRoot *string `json:"evidenceRoot,omitempty"`
	Samples      int     `json:"samples"`
}

type ObservationWindow struct {
	OpensAt  string `json:"opensAt"`
	ClosesAt string `json:"closesAt"`
}

type ProofOfObservation struct {
	MarketID          string            `json:"marketId"`
	StreamID          string            `json:"streamId"`
	Status            string            `json:"status"`
	ObservedValue     *int64            `json:"observedValue"`
	WinningOutcomeID  *string           `json:"winningOutcomeId"`
	RuleHash          string            `json:"ruleHash"`
	EvidenceRoot      *string           `json:"evidenceRoot"`
	ObservationWindow ObservationWindow `json:"observationWindow"`
	MinimumUptime     float64           `json:"minimumUptime"`
	MeasuredUptime    float64           `json:"measuredUptime"`
	ChallengeEndsAt   *string           `json:"challengeEndsAt"`
	Observers         []Observer        `json:"observers"`
}

type Position struct {
	ID              string  `json:"id"`
	MarketID        string  `json:"marketId"`
	ChainID         int64   `json:"chainId"`
	ContractAddress *string `json:"contractAddress,omitempty"`
	Question        string  `json:"question"`
	OutcomeLabel    string  `json:"outcomeLabel"`
	Amount          float64 `json:"amount"`
	EstimatedReturn float64 `json:"estimatedReturn"`
	State           string  `json:"state"`
	CreatedAt       string  `json:"createdAt"`
}

type Portfolio struct {
	Address         string     `json:"address"`
	Balance         float64    `json:"balance"`
	TotalPositioned float64    `json:"totalPositioned"`
	Claimable       float64    `json:"claimable"`
	Positions       []Position `json:"positions"`
}

type LeaderboardEntry struct {
	Rank        int     `json:"rank"`
	ID          string  `json:"id"`
	DisplayName string  `json:"displayName"`
	Kind        string  `json:"kind"`
	Specialty   string  `json:"specialty"`
	Forecasts   int     `json:"forecasts"`
	BrierScore  float64 `json:"brierScore"`
	Calibration float64 `json:"calibration"`
}

type RoomMessage struct {
	ID        string `json:"id"`
	MarketID  string `json:"marketId"`
	Author    string `json:"author"`
	Kind      string `json:"kind"`
	Body      string `json:"body"`
	CreatedAt string `json:"createdAt"`
}

type Notification struct {
	ID        string  `json:"id"`
	Kind      string  `json:"kind"`
	Title     string  `json:"title"`
	Body      string  `json:"body"`
	MarketID  *string `json:"marketId,omitempty"`
	CreatedAt string  `json:"createdAt"`
}

type ObserverReport struct {
	MarketID       string        `json:"marketId"`
	ObserverID     string        `json:"observerId"`
	Role           string        `json:"role"`
	ObservedValue  int64         `json:"observedValue"`
	Confidence     float64       `json:"confidence"`
	ModelVersion   string        `json:"modelVersion"`
	Uptime         float64       `json:"uptime"`
	DriftMS        float64       `json:"maximumTimestampDriftMs"`
	Visibility     float64       `json:"averageVisibility"`
	FrozenSeconds  float64       `json:"longestFrozenSeconds"`
	InvalidReasons []string      `json:"invalidReasons"`
	Signature      *string       `json:"signature,omitempty"`
	EvidenceRoot   *string       `json:"evidenceRoot,omitempty"`
	SceneHash      string        `json:"sceneHash,omitempty"`
	Counts         []CountSample `json:"counts,omitempty"`
}

type EvidenceSample struct {
	ObservedAt      time.Time `json:"observedAt"`
	Count           int64     `json:"count"`
	IntervalSeconds int       `json:"intervalSeconds"`
	Quality         float64   `json:"streamQuality"`
	ModelVersion    string    `json:"modelVersion"`
	FrameDigest     string    `json:"frameDigest"`
	Proof           []string  `json:"proof"`
}

type EvidenceBundle struct {
	MarketID   string           `json:"marketId"`
	ObserverID string           `json:"observerId"`
	Root       *string          `json:"root"`
	Recomputed string           `json:"recomputed"`
	Samples    []EvidenceSample `json:"samples"`
}

type CountSample struct {
	ObservedAt      string  `json:"observedAt"`
	Count           int64   `json:"count"`
	IntervalSeconds int     `json:"intervalSeconds"`
	Quality         float64 `json:"streamQuality"`
	ModelVersion    string  `json:"modelVersion"`
	FrameDigest     string  `json:"frameDigest,omitempty"`
}

var Units = map[string]string{
	"Traffic":    "vehicles",
	"Parking":    "arrivals",
	"Queues":     "people",
	"Operations": "items",
	"Footfall":   "people",
	"Mobility":   "vehicles",
	"Weather":    "readings",
}

func UnitFor(category string) string {
	if unit, ok := Units[category]; ok {
		return unit
	}
	return "events"
}
