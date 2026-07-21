pragma solidity 0.8.30;

import {IObservationResolver} from "./interfaces/IObservationResolver.sol";

abstract contract ObservationResolver is IObservationResolver {
    address public immutable admin;
    address public immutable observerRegistry;
    uint64 public immutable challengeWindow;

    constructor(address admin_, address observerRegistry_, uint64 challengeWindow_) {
        if (admin_ == address(0) || observerRegistry_ == address(0) || challengeWindow_ == 0) {
            revert InvalidConfiguration();
        }
        admin = admin_;
        observerRegistry = observerRegistry_;
        challengeWindow = challengeWindow_;
    }

    error InvalidConfiguration();
}
