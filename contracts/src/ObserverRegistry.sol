pragma solidity 0.8.30;

import {IObserverRegistry} from "./interfaces/IObserverRegistry.sol";

/// @notice The observers whose signatures can settle a market, and how many of
/// them have to agree.
///
/// The threshold can never exceed the number of active observers. A quorum
/// larger than the pool is a market that can never resolve, and one that falls
/// to a single observer is not a quorum at all.
contract ObserverRegistry is IObserverRegistry {
    address public immutable admin;
    uint8 public override signatureThreshold;
    uint16 public activeCount;

    mapping(address => bool) private _active;

    error InvalidConfiguration();
    error NotAdmin();
    error ThresholdTooLow();
    error ThresholdAboveActive();

    constructor(address admin_, uint8 threshold_) {
        if (admin_ == address(0)) revert InvalidConfiguration();
        if (threshold_ == 0) revert ThresholdTooLow();
        admin = admin_;
        signatureThreshold = threshold_;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    function setObserver(address observer, bool active) external override onlyAdmin {
        if (observer == address(0)) revert InvalidConfiguration();
        if (_active[observer] == active) return;

        _active[observer] = active;
        activeCount = active ? activeCount + 1 : activeCount - 1;

        // Dropping an observer must not leave behind a threshold nobody can
        // reach. Lower the threshold first.
        if (!active && activeCount < signatureThreshold) revert ThresholdAboveActive();

        emit ObserverStatusChanged(observer, active);
    }

    function setSignatureThreshold(uint8 nextThreshold) external override onlyAdmin {
        if (nextThreshold == 0) revert ThresholdTooLow();
        if (nextThreshold > activeCount) revert ThresholdAboveActive();

        uint8 previous = signatureThreshold;
        signatureThreshold = nextThreshold;
        emit SignatureThresholdChanged(previous, nextThreshold);
    }

    function isObserver(address observer) external view override returns (bool) {
        return _active[observer];
    }
}
