pragma solidity 0.8.30;

import {IERC20, SafeTransfer} from "./IERC20.sol";
import {IMarketFactory} from "./interfaces/IMarketFactory.sol";
import {PooledMarket} from "./PooledMarket.sol";
import {ScryTypes} from "./ScryTypes.sol";

/// @notice Deploys one market per rule and remembers where it went. The rule
/// hash is committed before the market opens and the resolver refuses any result
/// without it, so the question cannot be edited once people have taken a side.
contract MarketFactory is IMarketFactory {
    using SafeTransfer for IERC20;

    address public immutable admin;
    address public immutable override collateral;
    address public immutable override resolver;

    mapping(bytes32 => address) private _markets;
    bytes32[] private _marketIds;

    error InvalidConfiguration();
    error NotAdmin();
    error MarketExists();
    error BadWindow();
    error TooFewOutcomes();
    error OutcomeBandsOverlap();

    constructor(address admin_, address collateral_, address resolver_) {
        if (admin_ == address(0) || collateral_ == address(0) || resolver_ == address(0)) {
            revert InvalidConfiguration();
        }
        admin = admin_;
        collateral = collateral_;
        resolver = resolver_;
    }

    function createMarket(
        ScryTypes.MarketRule calldata rule,
        ScryTypes.Outcome[] calldata outcomes,
        uint256 sponsorReward
    ) external override returns (address market) {
        if (msg.sender != admin) revert NotAdmin();
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
                address(this), collateral, resolver, rule.ruleHash, rule.marketId, rule.locksAt, ids
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
