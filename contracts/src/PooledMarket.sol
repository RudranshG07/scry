pragma solidity 0.8.30;

import {IPooledMarket} from "./interfaces/IPooledMarket.sol";

abstract contract PooledMarket is IPooledMarket {
    address public immutable factory;
    address public immutable collateral;
    address public immutable resolver;
    bytes32 public immutable override ruleHash;

    constructor(address factory_, address collateral_, address resolver_, bytes32 ruleHash_) {
        if (factory_ == address(0) || collateral_ == address(0) || resolver_ == address(0) || ruleHash_ == bytes32(0)) {
            revert InvalidConfiguration();
        }
        factory = factory_;
        collateral = collateral_;
        resolver = resolver_;
        ruleHash = ruleHash_;
    }

    error InvalidConfiguration();
}
