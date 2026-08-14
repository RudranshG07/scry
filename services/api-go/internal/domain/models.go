package domain

import "time"

// ObserversRequired is how many independent observers must sign the same value
// for a market to settle. The screen used to say three while the engine asked
// for two and two ever ran, so a market showing "0/3" was waiting for an
// observer that does not exist.
const ObserversRequired = 2

// Claim is what a market counts. The kind decides which observer runs, so a new
// kind of countable thing needs an observer and nothing else.
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
	ID                string  `json:"id"`
	StreamID          string  `json:"streamId"`
	Category          string  `json:"category"`
	Unit              string  `json:"unit"`
	Location          string  `json:"location"`
	City              string  `json:"city"`
	Question          string  `json:"question"`
	Status            string  `json:"status"`
	Countdown         string  `json:"countdown"`
	Pool              float64 `json:"pool"`
	CurrentRate       float64 `json:"currentRate"`
	Baseline          float64 `json:"baseline"`
	Observers         int     `json:"observers"`
	ObserversRequired int     `json:"observersRequired"`
	ChainID           int64   `json:"chainId"`
	Claim             Claim   `json:"claim"`
	// Nil until the market has been deployed. Positions are only real once there
	// is a contract holding the collateral, so the client uses this to tell a
	// live market from one that exists in the database alone.
	ContractAddress     *string         `json:"contractAddress,omitempty"`
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

// StreamSource is a submitted link and what the last inspection made of it.
type StreamSource struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Region    string `json:"region"`
	Timezone  string `json:"timezone"`
	SourceURL string `json:"sourceUrl"`
	Status    string `json:"status"`
	// What this stream is set up to count. An inspection has to measure the
	// same thing the market settles on, and for a line claim that is crossings
	// over the window rather than how many subjects stand in frame.
	Claim Claim `json:"claim"`
}

// StreamSubmission is a link somebody wants markets run on, before anything has
// watched it. Nothing here is trusted: the inspector decides whether it can be
// counted, and until it does the stream opens no markets.
type StreamSubmission struct {
	SourceURL string `json:"sourceUrl"`
	Name      string `json:"name"`
	Region    string `json:"region"`
	Timezone  string `json:"timezone"`
	Category  string `json:"category"`
	Claim     Claim  `json:"claim"`
}

// Qualification is what watching a stream established about it.
type Qualification struct {
	Usable       bool    `json:"usable"`
	Reason       string  `json:"reason"`
	Counts       string  `json:"counts"`
	Subjects     float64 `json:"subjects"`
	Peak         int     `json:"peak"`
	Disagreement float64 `json:"disagreement"`
	Provisional  bool    `json:"provisional"`
	// What a market on this stream should be set at, measured from what the
	// camera actually passes in a window.
	Threshold int `json:"threshold"`
	// The view this verdict was reached on, so a later count taken after the
	// camera moved can be told apart from one taken on the scene that qualified.
	Scene string `json:"scene"`
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

// ObserverReport is one observer's answer for a market, submitted over the
// network. Observers are meant to be independent, so the API is the only way in.
type ObserverReport struct {
	MarketID       string   `json:"marketId"`
	ObserverID     string   `json:"observerId"`
	Role           string   `json:"role"`
	ObservedValue  int64    `json:"observedValue"`
	Confidence     float64  `json:"confidence"`
	ModelVersion   string   `json:"modelVersion"`
	Uptime         float64  `json:"uptime"`
	DriftMS        float64  `json:"maximumTimestampDriftMs"`
	Visibility     float64  `json:"averageVisibility"`
	FrozenSeconds  float64  `json:"longestFrozenSeconds"`
	InvalidReasons []string `json:"invalidReasons"`
	Signature      *string  `json:"signature,omitempty"`
	EvidenceRoot   *string  `json:"evidenceRoot,omitempty"`
	// What the camera was looking at while counting, so a count taken after the
	// view changed can be told from one taken on the scene that qualified.
	SceneHash string        `json:"sceneHash,omitempty"`
	Counts    []CountSample `json:"counts,omitempty"`
}

// EvidenceSample is one counting interval with the siblings needed to check it
// against the published root, so a single interval can be verified without
// republishing the footage behind it.
type EvidenceSample struct {
	ObservedAt      time.Time `json:"observedAt"`
	Count           int64     `json:"count"`
	IntervalSeconds int       `json:"intervalSeconds"`
	Quality         float64   `json:"streamQuality"`
	ModelVersion    string    `json:"modelVersion"`
	FrameDigest     string    `json:"frameDigest"`
	Proof           []string  `json:"proof"`
}

// EvidenceBundle carries the root the observer published alongside the root
// recomputed here from the stored intervals. They are shown separately on
// purpose: if they disagree, the record has been altered since it was committed,
// and hiding that behind a single field would be the one thing this must not do.
type EvidenceBundle struct {
	MarketID   string           `json:"marketId"`
	ObserverID string           `json:"observerId"`
	Root       *string          `json:"root"`
	Recomputed string           `json:"recomputed"`
	Samples    []EvidenceSample `json:"samples"`
}

// CountSample is one interval of counting behind a report.
type CountSample struct {
	ObservedAt      string  `json:"observedAt"`
	Count           int64   `json:"count"`
	IntervalSeconds int     `json:"intervalSeconds"`
	Quality         float64 `json:"streamQuality"`
	ModelVersion    string  `json:"modelVersion"`
	FrameDigest     string  `json:"frameDigest,omitempty"`
}

// Units name what a market counts. The category decides it, so a client never
// has to guess from the question text.
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
