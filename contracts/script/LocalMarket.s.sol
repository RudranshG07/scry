pragma solidity 0.8.30;

import {MarketFactory} from "../src/MarketFactory.sol";
import {PooledMarket} from "../src/PooledMarket.sol";
import {ScryTypes} from "../src/ScryTypes.sol";
import {DevUSDC} from "../src/DevUSDC.sol";

interface VmLike {
    function envAddress(string calldata name) external view returns (address);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @notice Opens one market on a local chain and takes a position on it, so the
/// deposit path is exercised against a real chain rather than described.
contract LocalMarket {
    VmLike constant vm = VmLike(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    function run() external returns (address market, uint256 yesPool, uint256 noPool) {
        MarketFactory factory = MarketFactory(vm.envAddress("SCRY_FACTORY"));
        DevUSDC usdc = DevUSDC(factory.collateral());

        ScryTypes.MarketRule memory rule = ScryTypes.MarketRule({
            marketId: keccak256("local-1"),
            streamId: keccak256("stream-local"),
            ruleHash: keccak256("rule-1"),
            opensAt: uint64(block.timestamp + 1),
            locksAt: uint64(block.timestamp + 600),
            observationStartsAt: uint64(block.timestamp + 600),
            observationEndsAt: uint64(block.timestamp + 1500),
            minimumUptimeBps: 9500,
            maximumTimestampDriftMs: 2000,
            maximumObserverDivergence: 20
        });

        ScryTypes.Outcome[] memory outcomes = new ScryTypes.Outcome[](2);
        outcomes[0] = ScryTypes.Outcome({
            id: keccak256("yes"), label: "Yes, above 400",
            minimum: 401, maximum: 0, hasMinimum: true, hasMaximum: false
        });
        outcomes[1] = ScryTypes.Outcome({
            id: keccak256("no"), label: "No, 400 or below",
            minimum: 0, maximum: 400, hasMinimum: false, hasMaximum: true
        });

        vm.startBroadcast();

        market = factory.createMarket(rule, outcomes, 0);

        // 250 USDC on yes, 100 on no. Six decimals, as USDC has everywhere.
        usdc.mint(msg.sender, 350_000_000);
        usdc.approve(market, type(uint256).max);
        PooledMarket(market).deposit(keccak256("yes"), 250_000_000);
        PooledMarket(market).deposit(keccak256("no"), 100_000_000);

        vm.stopBroadcast();

        yesPool = PooledMarket(market).poolFor(keccak256("yes"));
        noPool = PooledMarket(market).poolFor(keccak256("no"));
    }
}
