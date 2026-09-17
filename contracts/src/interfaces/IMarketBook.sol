pragma solidity 0.8.30;

import {ScryTypes} from "../ScryTypes.sol";

interface IMarketBook {
    event MarketOpened(
        bytes32 indexed marketId, bytes32 indexed streamId, bytes32 ruleHash, uint64 locksAt, uint64 observationEndsAt
    );
    event PositionDeposited(
        bytes32 indexed marketId, address indexed account, bytes32 indexed outcomeId, uint256 amount
    );
    event MarketResolved(
        bytes32 indexed marketId, bytes32 indexed winningOutcomeId, uint256 observedValue, bytes32 evidenceRoot
    );
    event MarketInvalidated(bytes32 indexed marketId, bytes32 reason);
    event Claimed(bytes32 indexed marketId, address indexed account, uint256 amount);
    event Refunded(bytes32 indexed marketId, address indexed account, uint256 amount);
    event OperatorChanged(address indexed previous, address indexed next);
    event LimitsChanged(uint256 maxPool, uint256 maxStake);
    event DepositsPaused(address indexed by);
    event DepositsResumed(address indexed by);

    function createMarket(
        ScryTypes.MarketRule calldata rule,
        ScryTypes.Outcome[] calldata outcomes,
        uint256 sponsorReward
    ) external;

    function deposit(bytes32 marketId, bytes32 outcomeId, uint256 amount) external;
    function claim(bytes32 marketId) external returns (uint256 amount);
    function refund(bytes32 marketId) external returns (uint256 amount);
    function abandon(bytes32 marketId) external;

    function resolve(bytes32 marketId, bytes32 winningOutcomeId, uint256 observedValue, bytes32 evidenceRoot)
        external;
    function invalidate(bytes32 marketId, bytes32 reason) external;

    function ruleHash(bytes32 marketId) external view returns (bytes32);
    function status(bytes32 marketId) external view returns (ScryTypes.MarketStatus);
    function poolFor(bytes32 marketId, bytes32 outcomeId) external view returns (uint256);
    function positionOf(bytes32 marketId, address account, bytes32 outcomeId) external view returns (uint256);
    function totalPool(bytes32 marketId) external view returns (uint256);
    function collateral() external view returns (address);
    function resolver() external view returns (address);
    function operator() external view returns (address);
    function depositsPaused() external view returns (bool);
    function maxPool() external view returns (uint256);
    function maxStake() external view returns (uint256);
}
