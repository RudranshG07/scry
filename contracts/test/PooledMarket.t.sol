pragma solidity 0.8.30;

import {PooledMarket} from "../src/PooledMarket.sol";
import {ScryTypes} from "../src/ScryTypes.sol";
import {SilentUSDC, vm} from "./Harness.sol";

contract PooledMarketTest {
    SilentUSDC usdc;
    PooledMarket market;

    address constant RESOLVER = address(0xBEEF);
    address constant ALICE = address(0xA11CE);
    address constant BOB = address(0xB0B);
    address constant CARL = address(0xCAFE);
    uint64 constant LOCKS_AT = 2_000_000_000;

    function _build() internal {
        usdc = new SilentUSDC();
        bytes32[] memory ids = new bytes32[](2);
        ids[0] = "yes";
        ids[1] = "no";
        market = new PooledMarket(
            address(this), address(usdc), RESOLVER, keccak256("rule"), "market-1", LOCKS_AT, ids
        );
        vm.warp(LOCKS_AT - 100);
    }

    function _stake(address who, bytes32 outcome, uint256 amount) internal {
        usdc.mint(who, amount);
        vm.startPrank(who);
        usdc.approve(address(market), amount);
        market.deposit(outcome, amount);
        vm.stopPrank();
    }

    function testWinnersSplitTheWholePoolInProportion() public {
        _build();
        _stake(ALICE, "yes", 300e6);
        _stake(BOB, "yes", 100e6);
        _stake(CARL, "no", 400e6);

        vm.warp(LOCKS_AT);
        market.lock();
        vm.prank(RESOLVER);
        market.resolve("yes", 214, keccak256("evidence"));

        vm.prank(ALICE);
        uint256 a = market.claim();
        vm.prank(BOB);
        uint256 b = market.claim();

        // Alice backed 3/4 of the winning side, so she takes 3/4 of all 800.
        require(a == 600e6, "alice");
        require(b == 200e6, "bob");
        require(a + b == 800e6, "pool fully paid out");
    }

    function testLosingSideCannotClaim() public {
        _build();
        _stake(ALICE, "yes", 100e6);
        _stake(BOB, "no", 100e6);

        vm.warp(LOCKS_AT);
        market.lock();
        vm.prank(RESOLVER);
        market.resolve("yes", 300, keccak256("e"));

        vm.prank(BOB);
        vm.expectRevert(PooledMarket.NothingToClaim.selector);
        market.claim();
    }

    function testAWinnerCannotClaimTwice() public {
        _build();
        _stake(ALICE, "yes", 100e6);
        _stake(BOB, "no", 100e6);

        vm.warp(LOCKS_AT);
        market.lock();
        vm.prank(RESOLVER);
        market.resolve("yes", 300, keccak256("e"));

        vm.prank(ALICE);
        market.claim();
        vm.prank(ALICE);
        vm.expectRevert(PooledMarket.AlreadySettled.selector);
        market.claim();
    }

    function testDepositClosesWhenTheClockSaysSoNotWhenLockIsCalled() public {
        _build();
        _stake(ALICE, "yes", 10e6);

        // Counting has started; nobody has called lock() yet. The book must
        // still be shut, or a position could be taken against a running count.
        vm.warp(LOCKS_AT);
        usdc.mint(BOB, 10e6);
        vm.startPrank(BOB);
        usdc.approve(address(market), 10e6);
        vm.expectRevert(PooledMarket.WrongStatus.selector);
        market.deposit("yes", 10e6);
        vm.stopPrank();
    }

    function testAnUnbackedWinnerRefundsEveryoneInsteadOfPayingNobody() public {
        _build();
        _stake(ALICE, "no", 100e6);
        _stake(BOB, "no", 50e6);

        vm.warp(LOCKS_AT);
        market.lock();
        vm.prank(RESOLVER);
        market.resolve("yes", 999, keccak256("e"));

        require(market.status() == ScryTypes.MarketStatus.Invalid, "invalid");
        vm.prank(ALICE);
        require(market.refund() == 100e6, "alice refunded");
        vm.prank(BOB);
        require(market.refund() == 50e6, "bob refunded");
    }

    function testInvalidMarketRefundsStakeNotWinnings() public {
        _build();
        _stake(ALICE, "yes", 100e6);
        _stake(BOB, "no", 300e6);

        vm.warp(LOCKS_AT);
        market.lock();
        vm.prank(RESOLVER);
        market.invalidate("observers disagreed");

        vm.prank(ALICE);
        require(market.refund() == 100e6, "stake back, not a share of 400");
        vm.prank(BOB);
        require(market.refund() == 300e6, "stake back");
    }

    function testOnlyTheResolverCanSettle() public {
        _build();
        _stake(ALICE, "yes", 10e6);
        vm.warp(LOCKS_AT);
        market.lock();

        vm.prank(ALICE);
        vm.expectRevert(PooledMarket.NotResolver.selector);
        market.resolve("yes", 5, keccak256("e"));
    }

    function testResolvedMarketCannotAlsoRefund() public {
        _build();
        _stake(ALICE, "yes", 10e6);
        _stake(BOB, "no", 10e6);
        vm.warp(LOCKS_AT);
        market.lock();
        vm.prank(RESOLVER);
        market.resolve("yes", 5, keccak256("e"));

        vm.prank(BOB);
        vm.expectRevert(PooledMarket.WrongStatus.selector);
        market.refund();
    }

    function testUnknownOutcomeIsRejected() public {
        _build();
        usdc.mint(ALICE, 10e6);
        vm.startPrank(ALICE);
        usdc.approve(address(market), 10e6);
        vm.expectRevert(PooledMarket.UnknownOutcome.selector);
        market.deposit("maybe", 10e6);
        vm.stopPrank();
    }
}
