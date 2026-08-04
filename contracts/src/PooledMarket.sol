pragma solidity 0.8.30;

import {IERC20, SafeTransfer} from "./IERC20.sol";
import {IPooledMarket} from "./interfaces/IPooledMarket.sol";
import {ScryTypes} from "./ScryTypes.sol";

/// @notice One market, settled parimutuel: a share of the winning pool is a
/// share of everything staked. A market nobody could observe refunds everybody,
/// so refusing to answer stays cheaper than answering wrongly.
contract PooledMarket is IPooledMarket {
    using SafeTransfer for IERC20;

    address public immutable factory;
    IERC20 public immutable collateral;
    address public immutable resolver;
    bytes32 public immutable override ruleHash;
    bytes32 public immutable marketId;
    uint64 public immutable locksAt;

    ScryTypes.MarketStatus private _status;
    bytes32 public winningOutcomeId;
    uint256 public observedValue;
    bytes32 public evidenceRoot;
    uint256 public totalPool;
    uint256 public sponsorPool;
    address public sponsor;

    bytes32[] private _outcomeIds;
    mapping(bytes32 => bool) private _isOutcome;
    mapping(bytes32 => uint256) private _pool;
    mapping(address => mapping(bytes32 => uint256)) private _position;
    mapping(address => uint256) private _staked;
    mapping(address => bool) private _settled;

    error InvalidConfiguration();
    error NotResolver();
    error NotFactory();
    error NotSponsor();
    error WrongStatus();
    error UnknownOutcome();
    error ZeroAmount();
    error NothingToClaim();
    error AlreadySettled();

    constructor(
        address factory_,
        address collateral_,
        address resolver_,
        bytes32 ruleHash_,
        bytes32 marketId_,
        uint64 locksAt_,
        bytes32[] memory ids
    ) {
        if (
            factory_ == address(0) || collateral_ == address(0) || resolver_ == address(0)
                || ruleHash_ == bytes32(0) || marketId_ == bytes32(0) || ids.length < 2
        ) {
            revert InvalidConfiguration();
        }

        factory = factory_;
        collateral = IERC20(collateral_);
        resolver = resolver_;
        ruleHash = ruleHash_;
        marketId = marketId_;
        locksAt = locksAt_;
        _status = ScryTypes.MarketStatus.Open;

        for (uint256 i = 0; i < ids.length; i++) {
            bytes32 id = ids[i];
            if (id == bytes32(0) || _isOutcome[id]) revert InvalidConfiguration();
            _isOutcome[id] = true;
            _outcomeIds.push(id);
        }
    }

    function deposit(bytes32 outcomeId, uint256 amount) external override {
        if (_status != ScryTypes.MarketStatus.Open) revert WrongStatus();
        // The clock closes the book, not lock(), or a position could be taken
        // against a count already running.
        if (block.timestamp >= locksAt) revert WrongStatus();
        if (!_isOutcome[outcomeId]) revert UnknownOutcome();
        if (amount == 0) revert ZeroAmount();

        collateral.pull(msg.sender, address(this), amount);

        _pool[outcomeId] += amount;
        _position[msg.sender][outcomeId] += amount;
        _staked[msg.sender] += amount;
        totalPool += amount;

        emit PositionDeposited(msg.sender, outcomeId, amount);
    }

    /// @notice Seed liquidity the factory has already sent. It joins the pool
    /// winners divide but belongs to no outcome, so it is never claimed directly.
    function seed(address sponsor_, uint256 amount) external {
        if (msg.sender != factory) revert NotFactory();
        if (_status != ScryTypes.MarketStatus.Open) revert WrongStatus();
        if (sponsor_ == address(0) || amount == 0) revert InvalidConfiguration();

        sponsor = sponsor_;
        sponsorPool = amount;
        totalPool += amount;
    }

    /// @notice Returns the seed once a market voids; it backs no stake, so
    /// nothing else would ever release it.
    function reclaimSeed() external returns (uint256 amount) {
        if (_status != ScryTypes.MarketStatus.Invalid) revert WrongStatus();
        if (msg.sender != sponsor) revert NotSponsor();

        amount = sponsorPool;
        if (amount == 0) revert NothingToClaim();

        sponsorPool = 0;
        collateral.send(sponsor, amount);
        emit Refunded(sponsor, amount);
    }

    function lock() external override {
        if (_status != ScryTypes.MarketStatus.Open) revert WrongStatus();
        if (block.timestamp < locksAt) revert WrongStatus();
        _status = ScryTypes.MarketStatus.Observing;
        emit MarketLocked(uint64(block.timestamp));
    }

    function resolve(bytes32 outcomeId, uint256 value, bytes32 root) external override {
        if (msg.sender != resolver) revert NotResolver();
        if (_status != ScryTypes.MarketStatus.Observing) revert WrongStatus();
        if (!_isOutcome[outcomeId]) revert UnknownOutcome();

        // Nothing backed the winner, so there is no pool to divide against.
        if (_pool[outcomeId] == 0) {
            _status = ScryTypes.MarketStatus.Invalid;
            emit MarketInvalidated("no winning stake");
            return;
        }

        winningOutcomeId = outcomeId;
        observedValue = value;
        evidenceRoot = root;
        _status = ScryTypes.MarketStatus.Resolved;

        emit MarketResolved(outcomeId, value, root);
    }

    function invalidate(bytes32 reason) external override {
        if (msg.sender != resolver) revert NotResolver();
        if (_status == ScryTypes.MarketStatus.Resolved || _status == ScryTypes.MarketStatus.Invalid) {
            revert WrongStatus();
        }
        _status = ScryTypes.MarketStatus.Invalid;
        emit MarketInvalidated(reason);
    }

    function claim() external override returns (uint256 amount) {
        if (_status != ScryTypes.MarketStatus.Resolved) revert WrongStatus();
        if (_settled[msg.sender]) revert AlreadySettled();

        uint256 backed = _position[msg.sender][winningOutcomeId];
        if (backed == 0) revert NothingToClaim();

        // Multiply before dividing to keep rounding loss under one unit.
        amount = (backed * totalPool) / _pool[winningOutcomeId];

        _settled[msg.sender] = true;
        collateral.send(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    function refund() external override returns (uint256 amount) {
        if (_status != ScryTypes.MarketStatus.Invalid) revert WrongStatus();
        if (_settled[msg.sender]) revert AlreadySettled();

        amount = _staked[msg.sender];
        if (amount == 0) revert NothingToClaim();

        _settled[msg.sender] = true;
        collateral.send(msg.sender, amount);
        emit Refunded(msg.sender, amount);
    }

    function status() external view override returns (ScryTypes.MarketStatus) {
        return _status;
    }

    function poolFor(bytes32 outcomeId) external view override returns (uint256) {
        return _pool[outcomeId];
    }

    function positionOf(address account, bytes32 outcomeId) external view override returns (uint256) {
        return _position[account][outcomeId];
    }

    function stakedBy(address account) external view returns (uint256) {
        return _staked[account];
    }

    function hasSettled(address account) external view returns (bool) {
        return _settled[account];
    }

    function outcomeIds() external view returns (bytes32[] memory) {
        return _outcomeIds;
    }
}
