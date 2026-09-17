pragma solidity 0.8.30;

import {ScryTypes} from "../ScryTypes.sol";

interface IObservationResolver {
    event ObservationProposed(
        bytes32 indexed marketId, bytes32 indexed evidenceRoot, uint256 observedValue, bytes32 winningOutcomeId
    );
    event ObservationChallenged(bytes32 indexed marketId, address indexed challenger, bytes32 reason);
    event ObservationFinalized(bytes32 indexed marketId, bytes32 indexed evidenceRoot);
    event ObservationInvalidated(bytes32 indexed marketId, bytes32 reason);

    function propose(bytes32 marketId, ScryTypes.ObservationResult calldata result, bytes[] calldata signatures)
        external;

    function challenge(bytes32 marketId, bytes32 reason) external;
    function finalize(bytes32 marketId) external;
    function invalidate(bytes32 marketId, bytes32 reason) external;
    function observationStatus(bytes32 marketId) external view returns (ScryTypes.ObservationStatus);
    function challengeEndsAt(bytes32 marketId) external view returns (uint64);
}
