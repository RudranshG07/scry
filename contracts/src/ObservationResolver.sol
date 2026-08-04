pragma solidity 0.8.30;

import {IObservationResolver} from "./interfaces/IObservationResolver.sol";
import {IObserverRegistry} from "./interfaces/IObserverRegistry.sol";
import {IPooledMarket} from "./interfaces/IPooledMarket.sol";
import {ScryTypes} from "./ScryTypes.sol";

/// @notice Carries a result from the observers to the market it settles.
///
/// A proposal needs enough signatures from distinct registered observers over
/// the exact result, and the result must name the market's rule hash, so a valid
/// reading of one market cannot be replayed against another. A challenged market
/// is voided rather than argued over.
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
