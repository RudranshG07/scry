pragma solidity 0.8.30;

import {IObserverRegistry} from "./interfaces/IObserverRegistry.sol";

abstract contract ObserverRegistry is IObserverRegistry {
    address public immutable admin;

    constructor(address admin_) {
        if (admin_ == address(0)) revert InvalidConfiguration();
        admin = admin_;
    }

    error InvalidConfiguration();
}
