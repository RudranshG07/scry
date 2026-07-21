package domain

type MarketOutcome struct {
	ID          string  `json:"id"`
	Label       string  `json:"label"`
	Probability float64 `json:"probability"`
	ReturnRate  float64 `json:"returnRate"`
}

type Market struct {
	ID                string          `json:"id"`
	StreamID          string          `json:"streamId"`
	Category          string          `json:"category"`
	Location          string          `json:"location"`
	City              string          `json:"city"`
	Question          string          `json:"question"`
	Status            string          `json:"status"`
	Countdown         string          `json:"countdown"`
	Pool              float64         `json:"pool"`
	Forecast          float64         `json:"forecast"`
	CurrentRate       float64         `json:"currentRate"`
	Baseline          float64         `json:"baseline"`
	Observers         int             `json:"observers"`
	OpensAt           string          `json:"opensAt"`
	LocksAt           string          `json:"locksAt"`
	ObservationEndsAt string          `json:"observationEndsAt"`
	ResolvedAt        *string         `json:"resolvedAt,omitempty"`
	ObservedValue     *int64          `json:"observedValue,omitempty"`
	WinningOutcomeID  *string         `json:"winningOutcomeId,omitempty"`
	Outcomes          []MarketOutcome `json:"outcomes"`
	Trend             []float64       `json:"trend"`
}

type Observer struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	Role         string  `json:"role"`
	State        string  `json:"state"`
	ModelVersion string  `json:"modelVersion"`
	Signature    *string `json:"signature,omitempty"`
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
