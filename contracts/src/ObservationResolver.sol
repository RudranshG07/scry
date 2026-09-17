pragma solidity 0.8.30;

import {IMarketBook} from "./interfaces/IMarketBook.sol";
import {IObservationResolver} from "./interfaces/IObservationResolver.sol";
import {IObserverRegistry} from "./interfaces/IObserverRegistry.sol";
import {ScryTypes} from "./ScryTypes.sol";

/// @notice Carries a result from the observers to the market it settles.
///
/// A proposal needs enough signatures from distinct registered observers over
/// the exact result, and the result must name the market and the rule hash the
/// book holds for it, so a valid reading of one market cannot be replayed
/// against another. The signed digest is EIP-712 and names this chain and this
/// resolver, so a reading signed for a testnet deployment cannot be replayed
/// against mainnet either.
///
/// Only the admin or the operator can challenge or void. An open challenge that
/// voids a market for the price of gas is one every losing position would file,
/// and no market would ever pay out. Voiding only ever refunds stakes, so the
/// operator's hot key can hold it; registering observers stays with the admin.
contract ObservationResolver is IObservationResolver {
    address public immutable admin;
    address public operator;
    address public immutable observerRegistry;
    uint64 public immutable challengeWindow;

    /// @dev The book is deployed after this, because it is constructed with the
    /// resolver's address. Whoever deployed this wires the two together once,
    /// and neither can be pointed anywhere else afterwards.
    address public book;
    address private immutable wiring;

    event OperatorChanged(address indexed previous, address indexed next);
    event BookSet(address indexed book);

    struct Proposal {
        bytes32 evidenceRoot;
        bytes32 winningOutcomeId;
        uint256 observedValue;
        uint64 challengeEndsAt;
        ScryTypes.ObservationStatus status;
        bool exists;
    }

    mapping(bytes32 => Proposal) private _proposals;

    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant NAME_HASH = keccak256("Scry");
    bytes32 private constant VERSION_HASH = keccak256("1");

    bytes32 private constant RESULT_TYPEHASH = keccak256(
        "ObservationResult(bytes32 marketId,uint256 observedValue,bytes32 winningOutcomeId,bytes32 evidenceRoot,bytes32 ruleHash,uint64 observedAt)"
    );

    /// @dev Upper bound of the lower half of the secp256k1 curve order.
    uint256 private constant HALF_ORDER = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    error InvalidConfiguration();
    error NotAdmin();
    error NotOperator();
    error BookAlreadySet();
    error NoBook();
    error AlreadyProposed();
    error MarketMismatch();
    error RuleMismatch();
    error TooFewSignatures();
    error SignaturesOutOfOrder();
    error NotAnObserver();
    error ChallengeClosed();
    error ChallengeOpen();
    error WrongStatus();
    error ResultMarkedInvalid();

    constructor(address admin_, address operator_, address observerRegistry_, uint64 challengeWindow_) {
        if (
            admin_ == address(0) || operator_ == address(0) || observerRegistry_ == address(0)
                || challengeWindow_ == 0
        ) {
            revert InvalidConfiguration();
        }
        admin = admin_;
        operator = operator_;
        observerRegistry = observerRegistry_;
        challengeWindow = challengeWindow_;
        wiring = msg.sender;
    }

    modifier onlyOperator() {
        if (msg.sender != operator && msg.sender != admin) revert NotOperator();
        _;
    }

    function setBook(address next) external {
        if (msg.sender != wiring && msg.sender != admin) revert NotAdmin();
        if (book != address(0)) revert BookAlreadySet();
        if (next == address(0)) revert InvalidConfiguration();
        book = next;
        emit BookSet(next);
    }

    function setOperator(address next) external {
        if (msg.sender != admin) revert NotAdmin();
        if (next == address(0)) revert InvalidConfiguration();
        emit OperatorChanged(operator, next);
        operator = next;
    }

    function propose(bytes32 marketId, ScryTypes.ObservationResult calldata result, bytes[] calldata signatures)
        external
        override
    {
        if (book == address(0)) revert NoBook();
        if (_proposals[marketId].exists) revert AlreadyProposed();
        if (result.invalid) revert ResultMarkedInvalid();
        if (result.marketId != marketId) revert MarketMismatch();
        if (result.ruleHash != IMarketBook(book).ruleHash(marketId)) revert RuleMismatch();

        _verify(result, signatures);

        _proposals[marketId] = Proposal({
            evidenceRoot: result.evidenceRoot,
            winningOutcomeId: result.winningOutcomeId,
            observedValue: result.observedValue,
            challengeEndsAt: uint64(block.timestamp) + challengeWindow,
            status: ScryTypes.ObservationStatus.Proposed,
            exists: true
        });

        emit ObservationProposed(marketId, result.evidenceRoot, result.observedValue, result.winningOutcomeId);
    }

    function challenge(bytes32 marketId, bytes32 reason) external override onlyOperator {
        Proposal storage p = _proposals[marketId];
        if (p.status != ScryTypes.ObservationStatus.Proposed) revert WrongStatus();
        if (block.timestamp >= p.challengeEndsAt) revert ChallengeClosed();

        p.status = ScryTypes.ObservationStatus.Challenged;
        emit ObservationChallenged(marketId, msg.sender, reason);

        IMarketBook(book).invalidate(marketId, reason);
        emit ObservationInvalidated(marketId, reason);
    }

    function finalize(bytes32 marketId) external override {
        Proposal storage p = _proposals[marketId];
        if (p.status != ScryTypes.ObservationStatus.Proposed) revert WrongStatus();
        if (block.timestamp < p.challengeEndsAt) revert ChallengeOpen();

        p.status = ScryTypes.ObservationStatus.Final;
        IMarketBook(book).resolve(marketId, p.winningOutcomeId, p.observedValue, p.evidenceRoot);
        emit ObservationFinalized(marketId, p.evidenceRoot);
    }

    function invalidate(bytes32 marketId, bytes32 reason) external override onlyOperator {
        if (book == address(0)) revert NoBook();
        Proposal storage p = _proposals[marketId];
        if (p.status == ScryTypes.ObservationStatus.Final) revert WrongStatus();

        p.status = ScryTypes.ObservationStatus.Invalid;
        p.exists = true;
        IMarketBook(book).invalidate(marketId, reason);
        emit ObservationInvalidated(marketId, reason);
    }

    function observationStatus(bytes32 marketId) external view override returns (ScryTypes.ObservationStatus) {
        return _proposals[marketId].status;
    }

    function challengeEndsAt(bytes32 marketId) external view override returns (uint64) {
        return _proposals[marketId].challengeEndsAt;
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    function digest(ScryTypes.ObservationResult calldata result) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                RESULT_TYPEHASH,
                result.marketId,
                result.observedValue,
                result.winningOutcomeId,
                result.evidenceRoot,
                result.ruleHash,
                result.observedAt
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    function _verify(ScryTypes.ObservationResult calldata result, bytes[] calldata signatures) private view {
        uint8 threshold = IObserverRegistry(observerRegistry).signatureThreshold();
        if (signatures.length < threshold) revert TooFewSignatures();

        bytes32 hash = digest(result);
        address previous = address(0);

        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = _recover(hash, signatures[i]);
            // Ascending order forces distinct signers without a nested loop.
            if (signer <= previous) revert SignaturesOutOfOrder();
            if (!IObserverRegistry(observerRegistry).isObserver(signer)) revert NotAnObserver();
            previous = signer;
        }
    }

    function _recover(bytes32 hash, bytes calldata signature) private pure returns (address) {
        if (signature.length != 65) revert NotAnObserver();

        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(signature[64]);

        // Both halves recover the same signer, so one signature could otherwise
        // be reshaped into a second that counts twice.
        if (uint256(s) > HALF_ORDER) revert NotAnObserver();

        address signer = ecrecover(hash, v, r, s);
        if (signer == address(0)) revert NotAnObserver();
        return signer;
    }
}
