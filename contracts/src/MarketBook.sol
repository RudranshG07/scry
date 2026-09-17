pragma solidity 0.8.30;

import {IERC20, SafeTransfer} from "./IERC20.sol";
import {IMarketBook} from "./interfaces/IMarketBook.sol";
import {ScryTypes} from "./ScryTypes.sol";

/// @notice Every market on one chain, in one contract.
///
/// One book rather than a contract per market, because of what it costs to
/// trade a four minute window: a market of its own took 1.37M gas to open and a
/// fresh USDC approval to enter, so a first position was a wait and two wallet
/// prompts. Here a trader approves this book once and every position after that
/// is one transaction, and opening a market is a tenth of the gas, which is what
/// lets every market be on chain before anyone wants it.
///
/// Settled parimutuel: a share of the winning pool is a share of everything
/// staked on that market. A market nobody could observe refunds everybody, so
/// refusing to answer stays cheaper than answering wrongly.
///
/// Two roles. The admin is meant to be a multisig: it names the operator, sets
/// the limits and alone can resume deposits. The operator is the server that
/// schedules markets, so its key is hot; it opens markets and can pause
/// deposits, and nothing it can do moves anyone's money anywhere but back.
contract MarketBook is IMarketBook {
    using SafeTransfer for IERC20;

    /// @notice How long after its observation window a market may sit unsettled
    /// before anyone can void it. Money must never depend on the operator
    /// staying up: if it disappears, every stake comes back.
    uint64 public constant ABANDON_AFTER = 1 days;

    address public immutable admin;
    address public immutable override collateral;
    address public immutable override resolver;
    address public override operator;
    bool public override depositsPaused;
    uint256 public override maxPool;
    uint256 public override maxStake;

    struct Market {
        bytes32 ruleHash;
        uint64 locksAt;
        uint64 observationEndsAt;
        ScryTypes.MarketStatus status;
        address sponsor;
        bytes32 winningOutcomeId;
        bytes32 evidenceRoot;
        uint256 observedValue;
        uint256 totalPool;
        uint256 sponsorPool;
        mapping(bytes32 => bool) isOutcome;
        mapping(bytes32 => uint256) pool;
        mapping(address => mapping(bytes32 => uint256)) position;
        mapping(address => uint256) staked;
        mapping(address => bool) settled;
    }

    mapping(bytes32 => Market) private _markets;
    bytes32[] private _ids;

    error InvalidConfiguration();
    error NotAdmin();
    error NotOperator();
    error NotResolver();
    error NotSponsor();
    error MarketExists();
    error NoSuchMarket();
    error BadWindow();
    error TooFewOutcomes();
    error OutcomeBandsOverlap();
    error WrongStatus();
    error UnknownOutcome();
    error ZeroAmount();
    error NothingToClaim();
    error AlreadySettled();
    error Paused();
    error PoolFull();
    error StakeTooLarge();
    error NotAbandoned();

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

    /// @notice Opens a market committed to its rule. The rule hash is written
    /// before anyone can enter and the resolver refuses any result without it,
    /// so the question cannot be edited once people have taken a side.
    function createMarket(
        ScryTypes.MarketRule calldata rule,
        ScryTypes.Outcome[] calldata outcomes,
        uint256 sponsorReward
    ) external override onlyOperator {
        if (rule.marketId == bytes32(0) || rule.ruleHash == bytes32(0)) revert InvalidConfiguration();
        if (outcomes.length < 2) revert TooFewOutcomes();
        if (
            rule.opensAt >= rule.locksAt || rule.locksAt > rule.observationStartsAt
                || rule.observationStartsAt >= rule.observationEndsAt
        ) {
            revert BadWindow();
        }

        Market storage market = _markets[rule.marketId];
        if (market.ruleHash != bytes32(0)) revert MarketExists();
        _requireCovering(outcomes);

        market.ruleHash = rule.ruleHash;
        market.locksAt = rule.locksAt;
        market.observationEndsAt = rule.observationEndsAt;
        market.status = ScryTypes.MarketStatus.Open;
        for (uint256 i = 0; i < outcomes.length; i++) {
            market.isOutcome[outcomes[i].id] = true;
        }
        _ids.push(rule.marketId);

        // Seed liquidity joins the pool winners divide but belongs to no
        // outcome, so it is never claimed directly and comes back to the
        // sponsor if the market voids.
        if (sponsorReward != 0) {
            IERC20(collateral).pull(msg.sender, address(this), sponsorReward);
            market.sponsor = msg.sender;
            market.sponsorPool = sponsorReward;
            market.totalPool = sponsorReward;
        }

        emit MarketOpened(rule.marketId, rule.streamId, rule.ruleHash, rule.locksAt, rule.observationEndsAt);
    }

    function deposit(bytes32 marketId, bytes32 outcomeId, uint256 amount) external override {
        Market storage market = _open(marketId);
        // The clock closes the book, not a call to lock it, or a position could
        // be taken against a count already running.
        if (block.timestamp >= market.locksAt) revert WrongStatus();
        if (!market.isOutcome[outcomeId]) revert UnknownOutcome();
        if (amount == 0) revert ZeroAmount();
        if (depositsPaused) revert Paused();
        if (market.totalPool - market.sponsorPool + amount > maxPool) revert PoolFull();
        if (market.staked[msg.sender] + amount > maxStake) revert StakeTooLarge();

        IERC20(collateral).pull(msg.sender, address(this), amount);

        market.pool[outcomeId] += amount;
        market.position[msg.sender][outcomeId] += amount;
        market.staked[msg.sender] += amount;
        market.totalPool += amount;

        emit PositionDeposited(marketId, msg.sender, outcomeId, amount);
    }

    function resolve(bytes32 marketId, bytes32 outcomeId, uint256 value, bytes32 root) external override {
        if (msg.sender != resolver) revert NotResolver();
        Market storage market = _markets[marketId];
        if (market.ruleHash == bytes32(0)) revert NoSuchMarket();
        // Past its lock the book is already shut, so settlement waits on nobody
        // having paid gas to close it.
        if (market.status != ScryTypes.MarketStatus.Open || block.timestamp < market.locksAt) revert WrongStatus();
        if (!market.isOutcome[outcomeId]) revert UnknownOutcome();

        // Nothing backed the winner, so there is no pool to divide against.
        if (market.pool[outcomeId] == 0) {
            market.status = ScryTypes.MarketStatus.Invalid;
            emit MarketInvalidated(marketId, "no winning stake");
            return;
        }

        market.winningOutcomeId = outcomeId;
        market.observedValue = value;
        market.evidenceRoot = root;
        market.status = ScryTypes.MarketStatus.Resolved;

        emit MarketResolved(marketId, outcomeId, value, root);
    }

    function invalidate(bytes32 marketId, bytes32 reason) external override {
        if (msg.sender != resolver) revert NotResolver();
        Market storage market = _markets[marketId];
        if (market.ruleHash == bytes32(0)) revert NoSuchMarket();
        if (market.status == ScryTypes.MarketStatus.Resolved || market.status == ScryTypes.MarketStatus.Invalid) {
            revert WrongStatus();
        }

        market.status = ScryTypes.MarketStatus.Invalid;
        emit MarketInvalidated(marketId, reason);
    }

    /// @notice Voids a market nobody settled, a day after its window. Anyone may
    /// call it, which is what keeps every stake recoverable without the server.
    function abandon(bytes32 marketId) external override {
        Market storage market = _markets[marketId];
        if (market.ruleHash == bytes32(0)) revert NoSuchMarket();
        if (market.status != ScryTypes.MarketStatus.Open) revert WrongStatus();
        if (block.timestamp < uint256(market.observationEndsAt) + ABANDON_AFTER) revert NotAbandoned();

        market.status = ScryTypes.MarketStatus.Invalid;
        emit MarketInvalidated(marketId, "abandoned");
    }

    function claim(bytes32 marketId) external override returns (uint256 amount) {
        Market storage market = _markets[marketId];
        if (market.status != ScryTypes.MarketStatus.Resolved) revert WrongStatus();
        if (market.settled[msg.sender]) revert AlreadySettled();

        uint256 backed = market.position[msg.sender][market.winningOutcomeId];
        if (backed == 0) revert NothingToClaim();

        // Multiply before dividing to keep rounding loss under one unit.
        amount = (backed * market.totalPool) / market.pool[market.winningOutcomeId];

        market.settled[msg.sender] = true;
        IERC20(collateral).send(msg.sender, amount);
        emit Claimed(marketId, msg.sender, amount);
    }

    function refund(bytes32 marketId) external override returns (uint256 amount) {
        Market storage market = _markets[marketId];
        if (market.status != ScryTypes.MarketStatus.Invalid) revert WrongStatus();
        if (market.settled[msg.sender]) revert AlreadySettled();

        amount = market.staked[msg.sender];
        if (amount == 0) revert NothingToClaim();

        market.settled[msg.sender] = true;
        IERC20(collateral).send(msg.sender, amount);
        emit Refunded(marketId, msg.sender, amount);
    }

    /// @notice Returns the seed once a market voids; it backs no stake, so
    /// nothing else would ever release it.
    function reclaimSeed(bytes32 marketId) external returns (uint256 amount) {
        Market storage market = _markets[marketId];
        if (market.status != ScryTypes.MarketStatus.Invalid) revert WrongStatus();
        if (msg.sender != market.sponsor) revert NotSponsor();

        amount = market.sponsorPool;
        if (amount == 0) revert NothingToClaim();

        market.sponsorPool = 0;
        IERC20(collateral).send(market.sponsor, amount);
        emit Refunded(marketId, market.sponsor, amount);
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

    function ruleHash(bytes32 marketId) external view override returns (bytes32) {
        return _markets[marketId].ruleHash;
    }

    function status(bytes32 marketId) external view override returns (ScryTypes.MarketStatus) {
        return _markets[marketId].status;
    }

    function poolFor(bytes32 marketId, bytes32 outcomeId) external view override returns (uint256) {
        return _markets[marketId].pool[outcomeId];
    }

    function positionOf(bytes32 marketId, address account, bytes32 outcomeId)
        external
        view
        override
        returns (uint256)
    {
        return _markets[marketId].position[account][outcomeId];
    }

    function totalPool(bytes32 marketId) external view override returns (uint256) {
        return _markets[marketId].totalPool;
    }

    function sponsorPool(bytes32 marketId) external view returns (uint256) {
        return _markets[marketId].sponsorPool;
    }

    function stakedBy(bytes32 marketId, address account) external view returns (uint256) {
        return _markets[marketId].staked[account];
    }

    function hasSettled(bytes32 marketId, address account) external view returns (bool) {
        return _markets[marketId].settled[account];
    }

    function winningOutcomeId(bytes32 marketId) external view returns (bytes32) {
        return _markets[marketId].winningOutcomeId;
    }

    function observedValue(bytes32 marketId) external view returns (uint256) {
        return _markets[marketId].observedValue;
    }

    function evidenceRoot(bytes32 marketId) external view returns (bytes32) {
        return _markets[marketId].evidenceRoot;
    }

    function locksAt(bytes32 marketId) external view returns (uint64) {
        return _markets[marketId].locksAt;
    }

    function observationEndsAt(bytes32 marketId) external view returns (uint64) {
        return _markets[marketId].observationEndsAt;
    }

    function isOutcome(bytes32 marketId, bytes32 outcomeId) external view returns (bool) {
        return _markets[marketId].isOutcome[outcomeId];
    }

    function marketCount() external view returns (uint256) {
        return _ids.length;
    }

    function marketIdAt(uint256 index) external view returns (bytes32) {
        return _ids[index];
    }

    function _open(bytes32 marketId) private view returns (Market storage market) {
        market = _markets[marketId];
        if (market.ruleHash == bytes32(0)) revert NoSuchMarket();
        if (market.status != ScryTypes.MarketStatus.Open) revert WrongStatus();
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
}
