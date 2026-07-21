pragma solidity 0.8.30;

import {IReputationCheckpoint} from "./interfaces/IReputationCheckpoint.sol";

abstract contract ReputationCheckpoint is IReputationCheckpoint {
    address public immutable admin;

    constructor(address admin_) {
        if (admin_ == address(0)) revert InvalidConfiguration();
        admin = admin_;
    }

    error InvalidConfiguration();
}
