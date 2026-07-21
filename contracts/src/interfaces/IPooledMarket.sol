pragma solidity 0.8.30;

import {ScryTypes} from "../ScryTypes.sol";

interface IPooledMarket {
    event PositionDeposited(address indexed account, bytes32 indexed outcomeId, uint256 amount);
    event MarketLocked(uint64 lockedAt);
    event MarketResolved(bytes32 indexed winningOutcomeId, uint256 observedValue, bytes32 evidenceRoot);
    event MarketInvalidated(bytes32 indexed reason);
    event Claimed(address indexed account, uint256 amount);
    event Refunded(address indexed account, uint256 amount);

    function deposit(bytes32 outcomeId, uint256 amount) external;
    function lock() external;
    function resolve(bytes32 winningOutcomeId, uint256 observedValue, bytes32 evidenceRoot) external;
    function invalidate(bytes32 reason) external;
    function claim() external returns (uint256 amount);
    function refund() external returns (uint256 amount);
    function status() external view returns (ScryTypes.MarketStatus);
    function ruleHash() external view returns (bytes32);
    function poolFor(bytes32 outcomeId) external view returns (uint256);
    function positionOf(address account, bytes32 outcomeId) external view returns (uint256);
}
