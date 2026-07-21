pragma solidity 0.8.30;

library ScryTypes {
    enum MarketStatus {
        Scheduled,
        Open,
        Locked,
        Observing,
        ResultProposed,
        Challenged,
        Resolved,
        Invalid
    }

    enum ObservationStatus {
        Proposed,
        Challenged,
        Final,
        Invalid
    }

    struct Outcome {
        bytes32 id;
        string label;
        uint256 minimum;
        uint256 maximum;
        bool hasMinimum;
        bool hasMaximum;
    }

    struct MarketRule {
        bytes32 marketId;
        bytes32 streamId;
        bytes32 ruleHash;
        uint64 opensAt;
        uint64 locksAt;
        uint64 observationStartsAt;
        uint64 observationEndsAt;
        uint16 minimumUptimeBps;
        uint32 maximumTimestampDriftMs;
        uint64 maximumObserverDivergence;
    }

    struct ObservationResult {
        bytes32 marketId;
        uint256 observedValue;
        bytes32 winningOutcomeId;
        bytes32 evidenceRoot;
        bytes32 ruleHash;
        uint64 observedAt;
        bool invalid;
    }
}
