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
    uint64 constant ENDS_AT = LOCKS_AT + 240;

    // The market reads its limits from its factory; this test stands in for it.
    bool public depositsPaused;
    uint256 public maxPool = 10_000e6;
    uint256 public maxStake = 1_000e6;

    function _build() internal {
        usdc = new SilentUSDC();
        bytes32[] memory ids = new bytes32[](2);
        ids[0] = "yes";
        ids[1] = "no";
        market = new PooledMarket(
            address(this), address(usdc), RESOLVER, keccak256("rule"), "market-1", LOCKS_AT, ENDS_AT, ids
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

    function _expectStakeRefused(address who, bytes32 outcome, uint256 amount, bytes4 reason) internal {
        usdc.mint(who, amount);
        vm.startPrank(who);
        usdc.approve(address(market), amount);
        vm.expectRevert(reason);
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
        _expectStakeRefused(BOB, "yes", 10e6, PooledMarket.WrongStatus.selector);
    }

    function testSettlementDoesNotWaitForAnyoneToCallLock() public {
        _build();
        _stake(ALICE, "yes", 10e6);
        _stake(BOB, "no", 10e6);

        vm.warp(LOCKS_AT);
        vm.prank(RESOLVER);
        market.resolve("yes", 5, keccak256("e"));

        require(market.status() == ScryTypes.MarketStatus.Resolved, "resolved without lock()");
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
        _expectStakeRefused(ALICE, "maybe", 10e6, PooledMarket.UnknownOutcome.selector);
    }

    function testAPausedMarketTakesNoDeposits() public {
        _build();
        depositsPaused = true;
        _expectStakeRefused(ALICE, "yes", 10e6, PooledMarket.Paused.selector);
    }

    function testOneWalletCannotStakeAboveItsCapAcrossOutcomes() public {
        _build();
        maxStake = 50e6;
        _stake(ALICE, "yes", 30e6);
        _expectStakeRefused(ALICE, "no", 30e6, PooledMarket.StakeTooLarge.selector);
    }

    function testThePoolStopsTakingMoneyAtItsCap() public {
        _build();
        maxPool = 100e6;
        _stake(ALICE, "yes", 60e6);
        _expectStakeRefused(BOB, "no", 50e6, PooledMarket.PoolFull.selector);
    }

    function testAMarketNobodySettlesRefundsAfterADay() public {
        _build();
        _stake(ALICE, "yes", 10e6);

        vm.warp(ENDS_AT + 1 days - 1);
        vm.expectRevert(PooledMarket.NotAbandoned.selector);
        market.abandon();

        vm.warp(ENDS_AT + 1 days);
        market.abandon();
        vm.prank(ALICE);
        require(market.refund() == 10e6, "stake back");
    }

    function testASettledMarketCannotBeAbandoned() public {
        _build();
        _stake(ALICE, "yes", 10e6);
        vm.warp(LOCKS_AT);
        vm.prank(RESOLVER);
        market.resolve("yes", 5, keccak256("e"));

        vm.warp(ENDS_AT + 2 days);
        vm.expectRevert(PooledMarket.WrongStatus.selector);
        market.abandon();
    }
}
