pragma solidity 0.8.30;

import {ScryTypes} from "../src/ScryTypes.sol";

/// @dev The repo carries no forge-std, so the few cheatcodes these tests need
/// are declared here rather than pulling in a dependency the build has never had.
interface Vm {
    function warp(uint256 timestamp) external;
    function prank(address sender) external;
    function startPrank(address sender) external;
    function stopPrank() external;
    function expectRevert(bytes4 selector) external;
    function expectRevert(bytes calldata revertData) external;
    function addr(uint256 privateKey) external pure returns (address);
    function sign(uint256 privateKey, bytes32 digest)
        external
        pure
        returns (uint8 v, bytes32 r, bytes32 s);
}

Vm constant vm = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

/// @dev USDC returns nothing from transfer on some chains. This mimics that so
/// the SafeTransfer path is exercised rather than assumed.
contract SilentUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external {
        allowance[msg.sender][spender] = amount;
    }

    function transfer(address to, uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
    }

    function transferFrom(address from, address to, uint256 amount) external {
        require(balanceOf[from] >= amount, "balance");
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}

library Fixtures {
    function rule(bytes32 marketId, uint64 locksAt) internal pure returns (ScryTypes.MarketRule memory r) {
        r.marketId = marketId;
        r.streamId = "stream-sd-8-15";
        r.ruleHash = keccak256(abi.encodePacked("rule", marketId));
        r.opensAt = locksAt - 480;
        r.locksAt = locksAt;
        r.observationStartsAt = locksAt;
        r.observationEndsAt = locksAt + 900;
        r.minimumUptimeBps = 9900;
        r.maximumTimestampDriftMs = 250;
        r.maximumObserverDivergence = 5;
    }

    /// Threshold bands matching what the engine schedules: yes above N, no at or
    /// below N. They meet exactly once and leave no gap.
    function bands(uint256 threshold) internal pure returns (ScryTypes.Outcome[] memory out) {
        out = new ScryTypes.Outcome[](2);
        out[0] = ScryTypes.Outcome({
            id: "yes",
            label: "Yes",
            minimum: threshold + 1,
            maximum: 0,
            hasMinimum: true,
            hasMaximum: false
        });
        out[1] = ScryTypes.Outcome({
            id: "no",
            label: "No",
            minimum: 0,
            maximum: threshold,
            hasMinimum: false,
            hasMaximum: true
        });
    }

    function result(bytes32 marketId, bytes32 ruleHash, uint256 value, bytes32 winner)
        internal
        pure
        returns (ScryTypes.ObservationResult memory r)
    {
        r.marketId = marketId;
        r.observedValue = value;
        r.winningOutcomeId = winner;
        r.evidenceRoot = keccak256(abi.encodePacked("evidence", marketId));
        r.ruleHash = ruleHash;
        r.observedAt = 1_800_000_000;
        r.invalid = false;
    }
}
