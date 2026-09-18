pragma solidity 0.8.30;

import {MarketBook} from "../src/MarketBook.sol";
import {ObserverRegistry} from "../src/ObserverRegistry.sol";
import {ScryTypes} from "../src/ScryTypes.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {SafeTransfer} from "../src/IERC20.sol";
import {Fixtures, RefusingUSDC, RevertingUSDC, SilentUSDC, vm} from "./Harness.sol";

contract MarketBookTest {
    SilentUSDC usdc;
    MarketBook book;

    address constant RESOLVER = address(0xBEEF);
    address constant OPERATOR = address(0xC0FFEE);
    address constant ALICE = address(0xA11CE);
    address constant BOB = address(0xB0B);
    address constant CARL = address(0xCAFE);

    bytes32 constant MARKET = "market-1";
    bytes32 constant OTHER = "market-2";
    uint64 constant LOCKS_AT = 2_000_000_000;
    uint64 constant ENDS_AT = LOCKS_AT + 900;

    function _build() internal {
        usdc = new SilentUSDC();
        book = new MarketBook(address(this), OPERATOR, address(usdc), RESOLVER, 10_000e6, 1_000e6);
        vm.warp(LOCKS_AT - 1000);
        book.createMarket(Fixtures.rule(MARKET, LOCKS_AT), Fixtures.bands(180), 0);
    }

    function _stake(address who, bytes32 outcome, uint256 amount) internal {
        usdc.mint(who, amount);
        vm.startPrank(who);
        usdc.approve(address(book), amount);
        book.deposit(MARKET, outcome, amount);
        vm.stopPrank();
    }

    function _expectStakeRefused(address who, bytes32 outcome, uint256 amount, bytes4 reason) internal {
        usdc.mint(who, amount);
        vm.startPrank(who);
        usdc.approve(address(book), amount);
        vm.expectRevert(reason);
        book.deposit(MARKET, outcome, amount);
        vm.stopPrank();
    }

    function testAMarketIsCommittedToItsRuleBeforeAnyoneCanEnter() public {
        _build();
        ScryTypes.MarketRule memory r = Fixtures.rule(MARKET, LOCKS_AT);

        require(book.ruleHash(MARKET) == r.ruleHash, "rule committed");
        require(book.locksAt(MARKET) == LOCKS_AT, "window carried through");
        require(book.observationEndsAt(MARKET) == r.observationEndsAt, "end of window carried through");
        require(book.status(MARKET) == ScryTypes.MarketStatus.Open, "open to positions");
        require(book.marketCount() == 1 && book.marketIdAt(0) == MARKET, "listed");
    }

    /// The whole point of one book: approve once, then trade any market.
    function testOneApprovalCoversEveryMarket() public {
        _build();
        book.createMarket(Fixtures.rule(OTHER, LOCKS_AT), Fixtures.bands(180), 0);

        usdc.mint(ALICE, 60e6);
        vm.startPrank(ALICE);
        usdc.approve(address(book), 60e6);
        book.deposit(MARKET, "yes", 20e6);
        book.deposit(OTHER, "no", 20e6);
        book.deposit(MARKET, "no", 20e6);
        vm.stopPrank();

        require(book.poolFor(MARKET, "yes") == 20e6, "first market");
        require(book.poolFor(OTHER, "no") == 20e6, "second market, same approval");
        require(book.totalPool(MARKET) == 40e6, "pools stay separate");
    }

    function testTheSameMarketCannotBeOpenedTwice() public {
        _build();
        vm.expectRevert(MarketBook.MarketExists.selector);
        book.createMarket(Fixtures.rule(MARKET, LOCKS_AT), Fixtures.bands(180), 0);
    }

    function testAMarketThatDoesNotExistTakesNoMoney() public {
        _build();
        usdc.mint(ALICE, 10e6);
        vm.startPrank(ALICE);
        usdc.approve(address(book), 10e6);
        vm.expectRevert(MarketBook.NoSuchMarket.selector);
        book.deposit("market-9", "yes", 10e6);
        vm.stopPrank();
    }

    function testOverlappingBandsAreRefused() public {
        _build();
        // Both bands contain 120, so a count of 120 would win twice. A market
        // like this could only ever invalidate.
        ScryTypes.Outcome[] memory bad = new ScryTypes.Outcome[](2);
        bad[0] = ScryTypes.Outcome("yes", "Yes", 100, 0, true, false);
        bad[1] = ScryTypes.Outcome("no", "No", 0, 150, false, true);

        vm.expectRevert(MarketBook.OutcomeBandsOverlap.selector);
        book.createMarket(Fixtures.rule(OTHER, LOCKS_AT), bad, 0);
    }

    function testAWindowThatRunsBackwardsIsRefused() public {
        _build();
        ScryTypes.MarketRule memory r = Fixtures.rule(OTHER, LOCKS_AT);
        r.observationEndsAt = r.observationStartsAt - 1;

        vm.expectRevert(MarketBook.BadWindow.selector);
        book.createMarket(r, Fixtures.bands(180), 0);
    }

    function testASingleOutcomeIsNotAMarket() public {
        _build();
        ScryTypes.Outcome[] memory one = new ScryTypes.Outcome[](1);
        one[0] = ScryTypes.Outcome("yes", "Yes", 0, 0, false, false);

        vm.expectRevert(MarketBook.TooFewOutcomes.selector);
        book.createMarket(Fixtures.rule(OTHER, LOCKS_AT), one, 0);
    }

    function testOnlyTheOperatorOrAdminOpensMarkets() public {
        _build();
        vm.prank(ALICE);
        vm.expectRevert(MarketBook.NotOperator.selector);
        book.createMarket(Fixtures.rule(OTHER, LOCKS_AT), Fixtures.bands(180), 0);

        vm.prank(OPERATOR);
        book.createMarket(Fixtures.rule(OTHER, LOCKS_AT), Fixtures.bands(180), 0);
        require(book.ruleHash(OTHER) != bytes32(0), "operator opens markets");
    }

    function testWinnersSplitTheWholePoolInProportion() public {
        _build();
        _stake(ALICE, "yes", 300e6);
        _stake(BOB, "yes", 100e6);
        _stake(CARL, "no", 400e6);

        vm.warp(LOCKS_AT);
        vm.prank(RESOLVER);
        book.resolve(MARKET, "yes", 214, keccak256("evidence"));

        vm.prank(ALICE);
        uint256 a = book.claim(MARKET);
        vm.prank(BOB);
        uint256 b = book.claim(MARKET);

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
        vm.prank(RESOLVER);
        book.resolve(MARKET, "yes", 300, keccak256("e"));

        vm.prank(BOB);
        vm.expectRevert(MarketBook.NothingToClaim.selector);
        book.claim(MARKET);
    }

    function testAWinnerCannotClaimTwice() public {
        _build();
        _stake(ALICE, "yes", 100e6);
        _stake(BOB, "no", 100e6);

        vm.warp(LOCKS_AT);
        vm.prank(RESOLVER);
        book.resolve(MARKET, "yes", 300, keccak256("e"));

        vm.prank(ALICE);
        book.claim(MARKET);
        vm.prank(ALICE);
        vm.expectRevert(MarketBook.AlreadySettled.selector);
        book.claim(MARKET);
    }

    function testTheClockShutsTheBookNotACallToCloseIt() public {
        _build();
        _stake(ALICE, "yes", 10e6);

        // Counting has started. The book must be shut, or a position could be
        // taken against a count already running.
        vm.warp(LOCKS_AT);
        _expectStakeRefused(BOB, "yes", 10e6, MarketBook.WrongStatus.selector);
    }

    function testSettlementWaitsForNobodyToCloseTheBook() public {
        _build();
        _stake(ALICE, "yes", 10e6);
        _stake(BOB, "no", 10e6);

        vm.warp(LOCKS_AT);
        vm.prank(RESOLVER);
        book.resolve(MARKET, "yes", 5, keccak256("e"));

        require(book.status(MARKET) == ScryTypes.MarketStatus.Resolved, "resolved");
    }

    function testAnUnbackedWinnerRefundsEveryoneInsteadOfPayingNobody() public {
        _build();
        _stake(ALICE, "no", 100e6);
        _stake(BOB, "no", 50e6);

        vm.warp(LOCKS_AT);
        vm.prank(RESOLVER);
        book.resolve(MARKET, "yes", 999, keccak256("e"));

        require(book.status(MARKET) == ScryTypes.MarketStatus.Invalid, "invalid");
        vm.prank(ALICE);
        require(book.refund(MARKET) == 100e6, "alice refunded");
        vm.prank(BOB);
        require(book.refund(MARKET) == 50e6, "bob refunded");
    }

    function testAnInvalidMarketRefundsStakeNotWinnings() public {
        _build();
        _stake(ALICE, "yes", 100e6);
        _stake(BOB, "no", 300e6);

        vm.warp(LOCKS_AT);
        vm.prank(RESOLVER);
        book.invalidate(MARKET, "observers disagreed");

        vm.prank(ALICE);
        require(book.refund(MARKET) == 100e6, "stake back, not a share of 400");
        vm.prank(BOB);
        require(book.refund(MARKET) == 300e6, "stake back");
    }

    function testOnlyTheResolverCanSettle() public {
        _build();
        _stake(ALICE, "yes", 10e6);
        vm.warp(LOCKS_AT);

        vm.prank(ALICE);
        vm.expectRevert(MarketBook.NotResolver.selector);
        book.resolve(MARKET, "yes", 5, keccak256("e"));
    }

    function testAResolvedMarketCannotAlsoRefund() public {
        _build();
        _stake(ALICE, "yes", 10e6);
        _stake(BOB, "no", 10e6);
        vm.warp(LOCKS_AT);
        vm.prank(RESOLVER);
        book.resolve(MARKET, "yes", 5, keccak256("e"));

        vm.prank(BOB);
        vm.expectRevert(MarketBook.WrongStatus.selector);
        book.refund(MARKET);
    }

    function testUnknownOutcomeIsRejected() public {
        _build();
        _expectStakeRefused(ALICE, "maybe", 10e6, MarketBook.UnknownOutcome.selector);
    }

    function testAPausedBookTakesNoDeposits() public {
        _build();
        vm.prank(OPERATOR);
        book.pauseDeposits();
        _expectStakeRefused(ALICE, "yes", 10e6, MarketBook.Paused.selector);
    }

    function testAStolenOperatorKeyCannotUndoAnEmergencyStop() public {
        _build();
        vm.prank(OPERATOR);
        book.pauseDeposits();

        vm.prank(OPERATOR);
        vm.expectRevert(MarketBook.NotAdmin.selector);
        book.resumeDeposits();
        require(book.depositsPaused(), "still paused");

        book.resumeDeposits();
        require(!book.depositsPaused(), "admin resumed");
    }

    function testTheOperatorCannotRaiseLimitsOrReplaceItself() public {
        _build();
        vm.prank(OPERATOR);
        vm.expectRevert(MarketBook.NotAdmin.selector);
        book.setLimits(1e12, 1e12);

        vm.prank(OPERATOR);
        vm.expectRevert(MarketBook.NotAdmin.selector);
        book.setOperator(ALICE);
    }

    function testLimitsThatCouldNotHoldAStakeAreRefused() public {
        _build();
        vm.expectRevert(MarketBook.InvalidConfiguration.selector);
        book.setLimits(100e6, 0);

        vm.expectRevert(MarketBook.InvalidConfiguration.selector);
        book.setLimits(100e6, 200e6);
    }

    function testLoweredLimitsReachMarketsAlreadyOpen() public {
        _build();
        book.setLimits(10_000e6, 20e6);
        _expectStakeRefused(ALICE, "yes", 50e6, MarketBook.StakeTooLarge.selector);
    }

    function testOneWalletCannotStakeAboveItsCapAcrossOutcomes() public {
        _build();
        book.setLimits(10_000e6, 50e6);
        _stake(ALICE, "yes", 30e6);
        _expectStakeRefused(ALICE, "no", 30e6, MarketBook.StakeTooLarge.selector);
    }

    function testAPoolStopsTakingMoneyAtItsCap() public {
        _build();
        book.setLimits(100e6, 100e6);
        _stake(ALICE, "yes", 60e6);
        _expectStakeRefused(BOB, "no", 50e6, MarketBook.PoolFull.selector);
    }

    function testACapIsPerMarketNotPerBook() public {
        _build();
        book.createMarket(Fixtures.rule(OTHER, LOCKS_AT), Fixtures.bands(180), 0);
        book.setLimits(100e6, 100e6);

        _stake(ALICE, "yes", 100e6);
        // The same wallet is at its cap here and free to stake on another
        // market: the limits hold a market's pool down, not a trader's day.
        usdc.mint(ALICE, 100e6);
        vm.startPrank(ALICE);
        usdc.approve(address(book), 100e6);
        book.deposit(OTHER, "yes", 100e6);
        vm.stopPrank();
        require(book.poolFor(OTHER, "yes") == 100e6, "second market took it");
    }

    function testSeedLiquidityIsPaidOutToWinnersNotStranded() public {
        _build();
        usdc.mint(address(this), 50e6);
        usdc.approve(address(book), 50e6);
        book.createMarket(Fixtures.rule(OTHER, LOCKS_AT), Fixtures.bands(180), 50e6);

        require(book.sponsorPool(OTHER) == 50e6, "seed recorded");
        require(book.totalPool(OTHER) == 50e6, "seed joins the pool winners divide");

        usdc.mint(ALICE, 100e6);
        vm.startPrank(ALICE);
        usdc.approve(address(book), 100e6);
        book.deposit(OTHER, "yes", 100e6);
        vm.stopPrank();

        vm.warp(LOCKS_AT);
        vm.prank(RESOLVER);
        book.resolve(OTHER, "yes", 214, keccak256("e"));

        vm.prank(ALICE);
        // Sole winner takes her stake and the seed with it.
        require(book.claim(OTHER) == 150e6, "seed reached the winner");
        require(usdc.balanceOf(address(book)) == 0, "nothing stranded");
    }

    function testTheSponsorTakesTheSeedBackIfTheMarketVoids() public {
        _build();
        usdc.mint(address(this), 50e6);
        usdc.approve(address(book), 50e6);
        book.createMarket(Fixtures.rule(OTHER, LOCKS_AT), Fixtures.bands(180), 50e6);

        usdc.mint(ALICE, 100e6);
        vm.startPrank(ALICE);
        usdc.approve(address(book), 100e6);
        book.deposit(OTHER, "yes", 100e6);
        vm.stopPrank();

        vm.warp(LOCKS_AT);
        vm.prank(RESOLVER);
        book.invalidate(OTHER, "observers disagreed");

        vm.prank(ALICE);
        require(book.refund(OTHER) == 100e6, "stake back");
        require(book.reclaimSeed(OTHER) == 50e6, "seed back to the sponsor");
        require(usdc.balanceOf(address(book)) == 0, "nothing stranded");
    }

    function testAMarketNobodySettlesRefundsAfterADay() public {
        _build();
        _stake(ALICE, "yes", 10e6);

        vm.warp(ENDS_AT + 1 days - 1);
        vm.expectRevert(MarketBook.NotAbandoned.selector);
        book.abandon(MARKET);

        vm.warp(ENDS_AT + 1 days);
        book.abandon(MARKET);
        vm.prank(ALICE);
        require(book.refund(MARKET) == 10e6, "stake back");
    }

    function testASettledMarketCannotBeAbandoned() public {
        _build();
        _stake(ALICE, "yes", 10e6);
        vm.warp(LOCKS_AT);
        vm.prank(RESOLVER);
        book.resolve(MARKET, "yes", 5, keccak256("e"));

        vm.warp(ENDS_AT + 2 days);
        vm.expectRevert(MarketBook.WrongStatus.selector);
        book.abandon(MARKET);
    }

    function testABookWithoutAResolverHoldsMoneyNobodyCanRelease() public {
        usdc = new SilentUSDC();
        vm.expectRevert(MarketBook.InvalidConfiguration.selector);
        new MarketBook(address(this), OPERATOR, address(usdc), address(0), 10_000e6, 1_000e6);
    }

    function testABookWithoutACollateralTokenIsRefused() public {
        vm.expectRevert(MarketBook.InvalidConfiguration.selector);
        new MarketBook(address(this), OPERATOR, address(0), RESOLVER, 10_000e6, 1_000e6);
    }

    function testTheOperatorOpensMarketsAsWellAsTheAdmin() public {
        _build();
        vm.prank(OPERATOR);
        book.createMarket(Fixtures.rule(OTHER, LOCKS_AT), Fixtures.bands(180), 0);
        require(book.marketCount() == 2, "the operator's market is on the book");
    }

    function testAMarketWithoutARuleIsRefused() public {
        _build();
        ScryTypes.MarketRule memory r = Fixtures.rule(OTHER, LOCKS_AT);
        r.ruleHash = bytes32(0);
        vm.expectRevert(MarketBook.InvalidConfiguration.selector);
        book.createMarket(r, Fixtures.bands(180), 0);
    }

    function testAMarketWithoutAnIdIsRefused() public {
        _build();
        ScryTypes.MarketRule memory r = Fixtures.rule(bytes32(0), LOCKS_AT);
        vm.expectRevert(MarketBook.InvalidConfiguration.selector);
        book.createMarket(r, Fixtures.bands(180), 0);
    }

    /// Two outcomes sharing an id would let a claim be paid from the wrong pool.
    function testTwoOutcomesCannotShareAnId() public {
        _build();
        ScryTypes.Outcome[] memory same = Fixtures.bands(180);
        same[1].id = same[0].id;
        vm.expectRevert(MarketBook.InvalidConfiguration.selector);
        book.createMarket(Fixtures.rule(OTHER, LOCKS_AT), same, 0);
    }

    function testADepositOfNothingIsRefused() public {
        _build();
        vm.prank(ALICE);
        vm.expectRevert(MarketBook.ZeroAmount.selector);
        book.deposit(MARKET, "yes", 0);
    }

    function testASettledMarketTakesNoFurtherPositions() public {
        _build();
        _stake(ALICE, "yes", 10e6);
        vm.warp(LOCKS_AT);
        vm.prank(RESOLVER);
        book.resolve(MARKET, "yes", 200, keccak256("e"));

        _expectStakeRefused(BOB, "no", 10e6, MarketBook.WrongStatus.selector);
    }

    function testAMarketThatWasNeverOpenedCannotBeSettled() public {
        _build();
        vm.warp(LOCKS_AT);
        vm.prank(RESOLVER);
        vm.expectRevert(MarketBook.NoSuchMarket.selector);
        book.resolve(OTHER, "yes", 200, keccak256("e"));
    }

    /// A result cannot arrive while the book is still taking money against it.
    function testAMarketCannotBeSettledBeforeItLocks() public {
        _build();
        vm.prank(RESOLVER);
        vm.expectRevert(MarketBook.WrongStatus.selector);
        book.resolve(MARKET, "yes", 200, keccak256("e"));
    }

    function testAWinningOutcomeTheMarketNeverOfferedIsRefused() public {
        _build();
        vm.warp(LOCKS_AT);
        vm.prank(RESOLVER);
        vm.expectRevert(MarketBook.UnknownOutcome.selector);
        book.resolve(MARKET, "maybe", 200, keccak256("e"));
    }

    function testOnlyTheResolverCanVoidAMarket() public {
        _build();
        vm.prank(ALICE);
        vm.expectRevert(MarketBook.NotResolver.selector);
        book.invalidate(MARKET, "nice try");
    }

    function testAMarketThatWasNeverOpenedCannotBeVoided() public {
        _build();
        vm.prank(RESOLVER);
        vm.expectRevert(MarketBook.NoSuchMarket.selector);
        book.invalidate(OTHER, "no such thing");
    }

    function testASettledMarketCannotThenBeVoided() public {
        _build();
        _stake(ALICE, "yes", 10e6);
        vm.warp(LOCKS_AT);
        vm.startPrank(RESOLVER);
        book.resolve(MARKET, "yes", 200, keccak256("e"));
        vm.expectRevert(MarketBook.WrongStatus.selector);
        book.invalidate(MARKET, "too late");
        vm.stopPrank();
    }

    function testAMarketThatWasNeverOpenedCannotBeAbandoned() public {
        _build();
        vm.warp(ENDS_AT + 2 days);
        vm.expectRevert(MarketBook.NoSuchMarket.selector);
        book.abandon(OTHER);
    }

    function testNothingIsPaidOutWhileTheMarketIsStillOpen() public {
        _build();
        _stake(ALICE, "yes", 10e6);
        vm.prank(ALICE);
        vm.expectRevert(MarketBook.WrongStatus.selector);
        book.claim(MARKET);
    }

    function testARefundCannotBeTakenTwice() public {
        _build();
        _stake(ALICE, "yes", 10e6);
        vm.prank(RESOLVER);
        book.invalidate(MARKET, "camera died");

        vm.startPrank(ALICE);
        require(book.refund(MARKET) == 10e6, "stake back once");
        vm.expectRevert(MarketBook.AlreadySettled.selector);
        book.refund(MARKET);
        vm.stopPrank();
    }

    function testSomeoneWhoNeverStakedGetsNoRefund() public {
        _build();
        _stake(ALICE, "yes", 10e6);
        vm.prank(RESOLVER);
        book.invalidate(MARKET, "camera died");

        vm.prank(CARL);
        vm.expectRevert(MarketBook.NothingToClaim.selector);
        book.refund(MARKET);
    }

    function testTheSeedStaysPutWhileTheMarketIsLive() public {
        _build();
        vm.expectRevert(MarketBook.WrongStatus.selector);
        book.reclaimSeed(MARKET);
    }

    function testOnlyTheSponsorTakesTheSeedBack() public {
        _build();
        vm.prank(RESOLVER);
        book.invalidate(MARKET, "camera died");

        vm.prank(ALICE);
        vm.expectRevert(MarketBook.NotSponsor.selector);
        book.reclaimSeed(MARKET);
    }

    function testTheSeedCannotBeReclaimedTwice() public {
        _build();
        usdc.mint(address(this), 50e6);
        usdc.approve(address(book), 50e6);
        book.createMarket(Fixtures.rule(OTHER, LOCKS_AT), Fixtures.bands(180), 50e6);

        vm.prank(RESOLVER);
        book.invalidate(OTHER, "camera died");

        require(book.reclaimSeed(OTHER) == 50e6, "seed back to the sponsor");
        vm.expectRevert(MarketBook.NothingToClaim.selector);
        book.reclaimSeed(OTHER);
    }

    /// An operator of nobody would leave the book unable to open a market again.
    function testTheOperatorCannotBeSetToNobody() public {
        _build();
        vm.expectRevert(MarketBook.InvalidConfiguration.selector);
        book.setOperator(address(0));
    }

    /// The admin shares the operator's emergency stop. Only the admin lifts it.
    function testTheAdminCanStopTheBookToo() public {
        _build();
        book.pauseDeposits();
        _expectStakeRefused(ALICE, "yes", 10e6, MarketBook.Paused.selector);
    }

    function testAStrangerCannotStopTheBook() public {
        _build();
        vm.prank(ALICE);
        vm.expectRevert(MarketBook.NotOperator.selector);
        book.pauseDeposits();
    }

    /// The API and the site read these by hand-encoded selector rather than
    /// through an ABI, so what they answer across a market is pinned here.
    function testTheViewsTheApiReadsFollowTheMarket() public {
        _build();
        require(book.isOutcome(MARKET, "yes"), "yes is an outcome of this market");
        require(!book.isOutcome(MARKET, "maybe"), "maybe is not");

        _stake(ALICE, "yes", 10e6);
        _stake(BOB, "no", 30e6);
        require(book.positionOf(MARKET, ALICE, "yes") == 10e6, "her position on the side she took");
        require(book.positionOf(MARKET, ALICE, "no") == 0, "nothing on the side she did not");
        require(book.stakedBy(MARKET, ALICE) == 10e6, "her stake across the whole market");
        require(!book.hasSettled(MARKET, ALICE), "nobody has settled while it is open");

        vm.warp(LOCKS_AT);
        vm.prank(RESOLVER);
        book.resolve(MARKET, "yes", 214, keccak256("e"));
        require(book.winningOutcomeId(MARKET) == "yes", "the winner is readable once settled");

        vm.prank(ALICE);
        book.claim(MARKET);
        require(book.hasSettled(MARKET, ALICE), "settled once she has been paid");
    }

    /// USDC deployments differ: some return nothing, some false, some revert.
    /// Only an empty return or an explicit true may count as money received.
    function testATokenThatAnswersFalseTakesNoDeposit() public {
        RefusingUSDC refusing = new RefusingUSDC();
        MarketBook liar = new MarketBook(address(this), OPERATOR, address(refusing), RESOLVER, 10_000e6, 1_000e6);
        vm.warp(LOCKS_AT - 1000);
        liar.createMarket(Fixtures.rule(MARKET, LOCKS_AT), Fixtures.bands(180), 0);

        vm.prank(ALICE);
        vm.expectRevert(SafeTransfer.TransferFailed.selector);
        liar.deposit(MARKET, "yes", 10e6);
    }

    function testATokenThatRevertsTakesNoDeposit() public {
        RevertingUSDC hostile = new RevertingUSDC();
        MarketBook refusing = new MarketBook(address(this), OPERATOR, address(hostile), RESOLVER, 10_000e6, 1_000e6);
        vm.warp(LOCKS_AT - 1000);
        refusing.createMarket(Fixtures.rule(MARKET, LOCKS_AT), Fixtures.bands(180), 0);

        vm.prank(ALICE);
        vm.expectRevert(SafeTransfer.TransferFailed.selector);
        refusing.deposit(MARKET, "yes", 10e6);
    }
}

contract ObserverRegistryTest {
    function testThresholdCannotExceedTheObserversWhoExist() public {
        ObserverRegistry r = new ObserverRegistry(address(this), 1);
        r.setObserver(address(0xA1), true);

        vm.expectRevert(ObserverRegistry.ThresholdAboveActive.selector);
        r.setSignatureThreshold(2);
    }

    function testAnObserverCannotBeDroppedBelowTheThreshold() public {
        ObserverRegistry r = new ObserverRegistry(address(this), 1);
        r.setObserver(address(0xA1), true);
        r.setObserver(address(0xA2), true);
        r.setSignatureThreshold(2);

        // Dropping to one active observer would leave a quorum of two that
        // nobody could ever reach, freezing every market on this registry.
        vm.expectRevert(ObserverRegistry.ThresholdAboveActive.selector);
        r.setObserver(address(0xA2), false);
    }

    function testAQuorumOfZeroIsRefused() public {
        ObserverRegistry r = new ObserverRegistry(address(this), 1);
        vm.expectRevert(ObserverRegistry.ThresholdTooLow.selector);
        r.setSignatureThreshold(0);
    }

    function testOnlyTheAdminChangesTheRegistry() public {
        ObserverRegistry r = new ObserverRegistry(address(this), 1);
        vm.prank(address(0xDEAD));
        vm.expectRevert(ObserverRegistry.NotAdmin.selector);
        r.setObserver(address(0xA1), true);
    }

    function testRegisteringTheSameObserverTwiceDoesNotInflateTheCount() public {
        ObserverRegistry r = new ObserverRegistry(address(this), 1);
        r.setObserver(address(0xA1), true);
        r.setObserver(address(0xA1), true);
        require(r.activeCount() == 1, "counted once");
    }

    function testARegistryWithoutAnAdminIsRefused() public {
        vm.expectRevert(ObserverRegistry.InvalidConfiguration.selector);
        new ObserverRegistry(address(0), 1);
    }

    /// Whoever registers observers can settle every market, so a registry that
    /// asked for no signatures at all would hand that to anyone.
    function testARegistryThatAsksForNoSignaturesIsRefused() public {
        vm.expectRevert(ObserverRegistry.ThresholdTooLow.selector);
        new ObserverRegistry(address(this), 0);
    }

    function testNobodyCannotBeRegisteredAsAnObserver() public {
        ObserverRegistry r = new ObserverRegistry(address(this), 1);
        vm.expectRevert(ObserverRegistry.InvalidConfiguration.selector);
        r.setObserver(address(0), true);
    }

    function testOnlyTheAdminSetsTheThreshold() public {
        ObserverRegistry r = new ObserverRegistry(address(this), 1);
        r.setObserver(address(0xA1), true);
        r.setObserver(address(0xA2), true);

        vm.prank(address(0xDEAD));
        vm.expectRevert(ObserverRegistry.NotAdmin.selector);
        r.setSignatureThreshold(2);
    }
}

contract DeployTest {
    Deploy d;

    function testCollateralIsPinnedPerChain() public {
        d = new Deploy();
        // Polygon must resolve to Circle's native USDC, which is what an
        // exchange sends when somebody withdraws. Bridged USDC.e, the token
        // Polymarket settles in, is a different contract entirely.
        require(d.collateralFor(137) == 0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359, "polygon native USDC");
        require(d.collateralFor(8453) == 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913, "base USDC");
        require(d.collateralFor(137) != d.collateralFor(8453), "chains do not share a token");
    }

    function testAnUnknownChainIsRefusedRatherThanGuessed() public {
        d = new Deploy();
        // Escrowing a token nobody holds would not surface until withdrawal.
        vm.expectRevert(abi.encodeWithSelector(Deploy.UnsupportedChain.selector, uint256(1)));
        d.collateralFor(1);
    }
}
