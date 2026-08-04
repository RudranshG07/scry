pragma solidity 0.8.30;

import {IReputationCheckpoint} from "./interfaces/IReputationCheckpoint.sol";

/// @notice Anchors forecaster scores an epoch at a time. Only the root is
/// published, and an epoch is written once: a leaderboard that can be edited
/// after the fact scores nothing.
contract ReputationCheckpoint is IReputationCheckpoint {
    address public immutable admin;
    uint64 public latestEpoch;

    struct Entry {
        bytes32 root;
        uint64 validAt;
    }

    mapping(uint64 => Entry) private _entries;

    error InvalidConfiguration();
    error NotAdmin();
    error EpochAlreadyPublished();
    error EpochOutOfOrder();

    constructor(address admin_) {
        if (admin_ == address(0)) revert InvalidConfiguration();
        admin = admin_;
    }

    function publish(uint64 epoch, bytes32 root, uint64 validAt) external override {
        if (msg.sender != admin) revert NotAdmin();
        if (root == bytes32(0)) revert InvalidConfiguration();
        if (_entries[epoch].root != bytes32(0)) revert EpochAlreadyPublished();
        if (epoch != latestEpoch + 1 && latestEpoch != 0) revert EpochOutOfOrder();

        _entries[epoch] = Entry({root: root, validAt: validAt});
        latestEpoch = epoch;
        emit CheckpointPublished(epoch, root, validAt);
    }

    function checkpoint(uint64 epoch) external view override returns (bytes32 root, uint64 validAt) {
        Entry storage e = _entries[epoch];
        return (e.root, e.validAt);
    }
}
