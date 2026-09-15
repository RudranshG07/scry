pragma solidity 0.8.30;

import {IERC20, SafeTransfer} from "./IERC20.sol";
import {IMarketFactory} from "./interfaces/IMarketFactory.sol";
import {PooledMarket} from "./PooledMarket.sol";
import {ScryTypes} from "./ScryTypes.sol";

/// @notice Deploys one market per rule and remembers where it went. The rule
/// hash is committed before the market opens and the resolver refuses any result
/// without it, so the question cannot be edited once people have taken a side.
///
/// Two roles. The admin is meant to be a multisig: it names the operator, sets
/// the limits and is the only one who can resume deposits. The operator is the
/// server that schedules markets, so its key is hot; it can create markets and
/// pause deposits, and nothing it can do moves anyone's money.
///
/// Limits live here rather than in each market, so lowering them reaches markets
/// that are already open.
contract MarketFactory is IMarketFactory {
    using SafeTransfer for IERC20;

    address public immutable admin;
    address public immutable override collateral;
    address public immutable override resolver;
    address public override operator;
    bool public override depositsPaused;
    uint256 public override maxPool;
    uint256 public override maxStake;

    mapping(bytes32 => address) private _markets;
    bytes32[] private _marketIds;

    error InvalidConfiguration();
    error NotAdmin();
    error NotOperator();
    error MarketExists();
    error BadWindow();
    error TooFewOutcomes();
    error OutcomeBandsOverlap();

    constructor(
        address admin_,
        address operator_,
        address collateral_,
        address resolver_,
        uint256 maxPool_,
        uint256 maxStake_
    ) {
        if (admin_ == address(0) || operator_ == address(0) || collateral_ == address(0) || resolver_ == address(0)) {
            revert InvalidConfiguration();
        }
        _requireLimits(maxPool_, maxStake_);
        admin = admin_;
        operator = operator_;
        collateral = collateral_;
        resolver = resolver_;
        maxPool = maxPool_;
        maxStake = maxStake_;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier onlyOperator() {
        if (msg.sender != operator && msg.sender != admin) revert NotOperator();
        _;
    }

    function createMarket(
        ScryTypes.MarketRule calldata rule,
        ScryTypes.Outcome[] calldata outcomes,
        uint256 sponsorReward
    ) external override onlyOperator returns (address market) {
        if (rule.marketId == bytes32(0) || rule.ruleHash == bytes32(0)) revert InvalidConfiguration();
        if (_markets[rule.marketId] != address(0)) revert MarketExists();
        if (outcomes.length < 2) revert TooFewOutcomes();

        if (
            rule.opensAt >= rule.locksAt || rule.locksAt > rule.observationStartsAt
                || rule.observationStartsAt >= rule.observationEndsAt
        ) {
            revert BadWindow();
        }

        bytes32[] memory ids = new bytes32[](outcomes.length);
        for (uint256 i = 0; i < outcomes.length; i++) {
            ids[i] = outcomes[i].id;
        }
        _requireCovering(outcomes);

        market = address(
            new PooledMarket{salt: rule.marketId}(
                address(this),
                collateral,
                resolver,
                rule.ruleHash,
                rule.marketId,
                rule.locksAt,
                rule.observationEndsAt,
                ids
            )
        );

        _markets[rule.marketId] = market;
        _marketIds.push(rule.marketId);

        // The market has to be told, or the seed sits outside the pool and is
        // paid to nobody and refundable by nobody.
        if (sponsorReward != 0) {
            IERC20(collateral).pull(msg.sender, market, sponsorReward);
            PooledMarket(market).seed(msg.sender, sponsorReward);
        }

        emit MarketCreated(rule.marketId, market, rule.streamId, rule.ruleHash);
    }

    function setOperator(address next) external onlyAdmin {
        if (next == address(0)) revert InvalidConfiguration();
        emit OperatorChanged(operator, next);
        operator = next;
    }

    function setLimits(uint256 maxPool_, uint256 maxStake_) external onlyAdmin {
        _requireLimits(maxPool_, maxStake_);
        maxPool = maxPool_;
        maxStake = maxStake_;
        emit LimitsChanged(maxPool_, maxStake_);
    }

    /// @notice Either role can stop new money coming in; only the admin can let
    /// it start again, so a stolen operator key cannot undo an emergency stop.
    function pauseDeposits() external onlyOperator {
        depositsPaused = true;
        emit DepositsPaused(msg.sender);
    }

    function resumeDeposits() external onlyAdmin {
        depositsPaused = false;
        emit DepositsResumed(msg.sender);
    }

    function _requireLimits(uint256 maxPool_, uint256 maxStake_) private pure {
        if (maxPool_ == 0 || maxStake_ == 0 || maxStake_ > maxPool_) revert InvalidConfiguration();
    }

    /// @dev Every count must land in exactly one band, or the market can only
    /// ever invalidate.
    function _requireCovering(ScryTypes.Outcome[] calldata outcomes) private pure {
        for (uint256 i = 0; i < outcomes.length; i++) {
            for (uint256 j = i + 1; j < outcomes.length; j++) {
                if (outcomes[i].id == outcomes[j].id) revert InvalidConfiguration();
                if (_overlaps(outcomes[i], outcomes[j])) revert OutcomeBandsOverlap();
            }
        }
    }

    function _overlaps(ScryTypes.Outcome calldata a, ScryTypes.Outcome calldata b) private pure returns (bool) {
        uint256 aLow = a.hasMinimum ? a.minimum : 0;
        uint256 aHigh = a.hasMaximum ? a.maximum : type(uint256).max;
        uint256 bLow = b.hasMinimum ? b.minimum : 0;
        uint256 bHigh = b.hasMaximum ? b.maximum : type(uint256).max;
        return aLow <= bHigh && bLow <= aHigh;
    }

    function marketFor(bytes32 marketId) external view override returns (address) {
        return _markets[marketId];
    }

    function marketCount() external view returns (uint256) {
        return _marketIds.length;
    }

    function marketIdAt(uint256 index) external view returns (bytes32) {
        return _marketIds[index];
    }
}
