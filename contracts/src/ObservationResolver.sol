pragma solidity 0.8.30;

import {IObservationResolver} from "./interfaces/IObservationResolver.sol";
import {IObserverRegistry} from "./interfaces/IObserverRegistry.sol";
import {IPooledMarket} from "./interfaces/IPooledMarket.sol";
import {ScryTypes} from "./ScryTypes.sol";

/// @notice Carries a result from the observers to the market it settles.
///
/// A proposal is accepted only with enough signatures from distinct registered
/// observers over the exact result, and the result has to name the rule hash the
/// market was built with. That pairing is the point: it stops a valid reading of
/// one market being replayed against another, the same class of mistake as an
/// observer reporting a count for a camera it never watched.
///
/// Nothing pays out until the challenge window closes. Anyone may challenge, and
/// a challenged market is voided rather than argued over: the honest answer to a
/// disputed reading is a refund, not a verdict this contract could reach.
contract ObservationResolver is IObservationResolver {
    address public immutable admin;
    address public immutable observerRegistry;
    uint64 public immutable challengeWindow;

    struct Proposal {
        bytes32 evidenceRoot;
        bytes32 winningOutcomeId;
        uint256 observedValue;
        uint64 challengeEndsAt;
        ScryTypes.ObservationStatus status;
        bool exists;
    }

    mapping(address => Proposal) private _proposals;

    bytes32 private constant RESULT_TYPEHASH = keccak256(
        "ObservationResult(bytes32 marketId,uint256 observedValue,bytes32 winningOutcomeId,bytes32 evidenceRoot,bytes32 ruleHash,uint64 observedAt)"
    );

    /// @dev Upper bound of the lower half of the secp256k1 curve order.
    uint256 private constant HALF_ORDER =
        0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    error InvalidConfiguration();
    error NotAdmin();
    error AlreadyProposed();
    error RuleMismatch();
    error TooFewSignatures();
    error SignaturesOutOfOrder();
    error NotAnObserver();
    error ChallengeClosed();
    error ChallengeOpen();
    error WrongStatus();
    error ResultMarkedInvalid();

    constructor(address admin_, address observerRegistry_, uint64 challengeWindow_) {
        if (admin_ == address(0) || observerRegistry_ == address(0) || challengeWindow_ == 0) {
            revert InvalidConfiguration();
        }
        admin = admin_;
        observerRegistry = observerRegistry_;
        challengeWindow = challengeWindow_;
    }

    function propose(address market, ScryTypes.ObservationResult calldata result, bytes[] calldata signatures)
        external
        override
    {
        if (_proposals[market].exists) revert AlreadyProposed();
        if (result.invalid) revert ResultMarkedInvalid();
        // The signatures authorise a reading of this market under this rule.
        // Without both bindings a result could be lifted onto another market.
        if (result.ruleHash != IPooledMarket(market).ruleHash()) revert RuleMismatch();

        _verify(result, signatures);

        _proposals[market] = Proposal({
            evidenceRoot: result.evidenceRoot,
            winningOutcomeId: result.winningOutcomeId,
            observedValue: result.observedValue,
            challengeEndsAt: uint64(block.timestamp) + challengeWindow,
            status: ScryTypes.ObservationStatus.Proposed,
            exists: true
        });

        emit ObservationProposed(market, result.evidenceRoot, result.observedValue, result.winningOutcomeId);
    }

    function challenge(address market, bytes32 reason) external override {
        Proposal storage p = _proposals[market];
        if (p.status != ScryTypes.ObservationStatus.Proposed) revert WrongStatus();
        if (block.timestamp >= p.challengeEndsAt) revert ChallengeClosed();

        p.status = ScryTypes.ObservationStatus.Challenged;
        emit ObservationChallenged(market, msg.sender, reason);

        // A disputed reading is not a reading. Void and refund rather than leave
        // stake riding on a number somebody has already objected to.
        IPooledMarket(market).invalidate(reason);
        emit ObservationInvalidated(market, reason);
    }

    function finalize(address market) external override {
        Proposal storage p = _proposals[market];
        if (p.status != ScryTypes.ObservationStatus.Proposed) revert WrongStatus();
        if (block.timestamp < p.challengeEndsAt) revert ChallengeOpen();

        p.status = ScryTypes.ObservationStatus.Final;
        IPooledMarket(market).resolve(p.winningOutcomeId, p.observedValue, p.evidenceRoot);
        emit ObservationFinalized(market, p.evidenceRoot);
    }

    function invalidate(address market, bytes32 reason) external override {
        if (msg.sender != admin) revert NotAdmin();
        Proposal storage p = _proposals[market];
        if (p.status == ScryTypes.ObservationStatus.Final) revert WrongStatus();

        p.status = ScryTypes.ObservationStatus.Invalid;
        p.exists = true;
        IPooledMarket(market).invalidate(reason);
        emit ObservationInvalidated(market, reason);
    }

    function observationStatus(address market) external view override returns (ScryTypes.ObservationStatus) {
        return _proposals[market].status;
    }

    function challengeEndsAt(address market) external view override returns (uint64) {
        return _proposals[market].challengeEndsAt;
    }

    function digest(ScryTypes.ObservationResult calldata result) public pure returns (bytes32) {
        return keccak256(
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
    }

    function _verify(ScryTypes.ObservationResult calldata result, bytes[] calldata signatures) private view {
        uint8 threshold = IObserverRegistry(observerRegistry).signatureThreshold();
        if (signatures.length < threshold) revert TooFewSignatures();

        bytes32 hash = digest(result);
        address previous = address(0);

        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = _recover(hash, signatures[i]);
            // Ascending order forces distinct signers without a nested loop, so
            // one observer cannot sign twice to reach quorum on its own.
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

        // Both halves of the curve recover the same signer, so accepting the
        // upper half would let one signature be reshaped into a second that
        // looks distinct and counts twice toward the threshold.
        if (uint256(s) > HALF_ORDER) revert NotAnObserver();

        address signer = ecrecover(hash, v, r, s);
        if (signer == address(0)) revert NotAnObserver();
        return signer;
    }
}
