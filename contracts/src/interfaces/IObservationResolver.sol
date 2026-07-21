pragma solidity 0.8.30;

import {ScryTypes} from "../ScryTypes.sol";

interface IObservationResolver {
    event ObservationProposed(
        address indexed market, bytes32 indexed evidenceRoot, uint256 observedValue, bytes32 winningOutcomeId
    );
    event ObservationChallenged(address indexed market, address indexed challenger, bytes32 reason);
    event ObservationFinalized(address indexed market, bytes32 indexed evidenceRoot);
    event ObservationInvalidated(address indexed market, bytes32 reason);

    function propose(address market, ScryTypes.ObservationResult calldata result, bytes[] calldata signatures) external;

    function challenge(address market, bytes32 reason) external;
    function finalize(address market) external;
    function invalidate(address market, bytes32 reason) external;
    function observationStatus(address market) external view returns (ScryTypes.ObservationStatus);
    function challengeEndsAt(address market) external view returns (uint64);
}
