pragma solidity 0.8.30;

import {IReputationCheckpoint} from "./interfaces/IReputationCheckpoint.sol";

/// @notice Anchors forecaster scores an epoch at a time.
///
/// Scores are computed off chain, where the history lives; only the root is
/// published, so anyone can prove their own record against it without the chain
/// carrying every forecast. An epoch is written once and never rewritten - a
/// leaderboard that can be edited after the fact scores nothing.
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
        // Epochs land in order, so a gap is a missing checkpoint rather than
        // something to be backfilled later against a record that has moved on.
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
