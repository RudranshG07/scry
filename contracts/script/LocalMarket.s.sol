pragma solidity 0.8.30;

import {MarketBook} from "../src/MarketBook.sol";
import {ScryTypes} from "../src/ScryTypes.sol";
import {DevUSDC} from "../src/DevUSDC.sol";

interface VmLike {
    function envAddress(string calldata name) external view returns (address);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @notice Opens one market on a local chain and takes both sides of it, so the
/// deposit path is exercised against a real chain rather than described.
contract LocalMarket {
    VmLike constant vm = VmLike(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    function run() external returns (bytes32 marketId, uint256 yesPool, uint256 noPool) {
        MarketBook book = MarketBook(vm.envAddress("SCRY_BOOK"));
        DevUSDC usdc = DevUSDC(book.collateral());

        marketId = "local-1";
        ScryTypes.MarketRule memory rule = ScryTypes.MarketRule({
            marketId: marketId,
            streamId: "stream-local",
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
            id: "yes", label: "Yes, above 400",
            minimum: 401, maximum: 0, hasMinimum: true, hasMaximum: false
        });
        outcomes[1] = ScryTypes.Outcome({
            id: "no", label: "No, 400 or below",
            minimum: 0, maximum: 400, hasMinimum: false, hasMaximum: true
        });

        vm.startBroadcast();

        book.createMarket(rule, outcomes, 0);

        // 60 USDC on yes, 40 on no: one wallet, inside the default 100 USDC
        // stake limit, and one approval covering both, which is what the book is
        // for. Six decimals, as USDC has everywhere.
        usdc.mint(msg.sender, 100_000_000);
        usdc.approve(address(book), 100_000_000);
        book.deposit(marketId, "yes", 60_000_000);
        book.deposit(marketId, "no", 40_000_000);

        vm.stopBroadcast();

        yesPool = book.poolFor(marketId, "yes");
        noPool = book.poolFor(marketId, "no");
    }
}
