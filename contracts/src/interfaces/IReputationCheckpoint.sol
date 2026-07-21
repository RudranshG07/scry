pragma solidity 0.8.30;

interface IReputationCheckpoint {
    event CheckpointPublished(uint64 indexed epoch, bytes32 indexed root, uint64 validAt);

    function publish(uint64 epoch, bytes32 root, uint64 validAt) external;
    function checkpoint(uint64 epoch) external view returns (bytes32 root, uint64 validAt);
}
