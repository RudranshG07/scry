pragma solidity 0.8.30;

import {IMarketFactory} from "./interfaces/IMarketFactory.sol";

abstract contract MarketFactory is IMarketFactory {
    address public immutable admin;
    address public immutable override collateral;
    address public immutable override resolver;

    constructor(address admin_, address collateral_, address resolver_) {
        if (admin_ == address(0) || collateral_ == address(0) || resolver_ == address(0)) {
            revert InvalidConfiguration();
        }
        admin = admin_;
        collateral = collateral_;
        resolver = resolver_;
    }

    error InvalidConfiguration();
}
