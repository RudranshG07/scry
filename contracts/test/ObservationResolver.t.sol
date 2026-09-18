pragma solidity 0.8.30;

import {MarketBook} from "../src/MarketBook.sol";
import {ObservationResolver} from "../src/ObservationResolver.sol";
import {ObserverRegistry} from "../src/ObserverRegistry.sol";
import {ScryTypes} from "../src/ScryTypes.sol";
import {Fixtures, SilentUSDC, vm} from "./Harness.sol";

contract ObservationResolverTest {
    SilentUSDC usdc;
    ObserverRegistry registry;
    ObservationResolver resolver;
    MarketBook book;

    uint256 constant PRIMARY_KEY = 0xA1;
    uint256 constant VERIFY_KEY = 0xB2;
    uint256 constant STRANGER_KEY = 0xC3;

    uint64 constant LOCKS_AT = 2_000_000_000;
    uint64 constant CHALLENGE = 600;
    bytes32 constant MARKET = "market-1";
    address constant OPERATOR = address(0xC0FFEE);
    address constant ALICE = address(0xA11CE);
    address constant BOB = address(0xB0B);

    function _ruleHash() internal pure returns (bytes32) {
        return Fixtures.rule(MARKET, LOCKS_AT).ruleHash;
    }

    function _build() internal {
        usdc = new SilentUSDC();
        registry = new ObserverRegistry(address(this), 1);
        registry.setObserver(vm.addr(PRIMARY_KEY), true);
        registry.setObserver(vm.addr(VERIFY_KEY), true);
        registry.setSignatureThreshold(2);

        resolver = new ObservationResolver(address(this), OPERATOR, address(registry), CHALLENGE);
        book = new MarketBook(address(this), address(this), address(usdc), address(resolver), 10_000e6, 1_000e6);
        resolver.setBook(address(book));

        vm.warp(LOCKS_AT - 100);
        book.createMarket(Fixtures.rule(MARKET, LOCKS_AT), Fixtures.bands(180), 0);
        _stake(ALICE, "yes", 100e6);
        _stake(BOB, "no", 100e6);
        vm.warp(LOCKS_AT);
    }

    function _stake(address who, bytes32 outcome, uint256 amount) internal {
        usdc.mint(who, amount);
        vm.startPrank(who);
        usdc.approve(address(book), amount);
        book.deposit(MARKET, outcome, amount);
        vm.stopPrank();
    }

    function _sign(uint256 key, ScryTypes.ObservationResult memory r) internal view returns (bytes memory) {
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(key, resolver.digest(r));
        return abi.encodePacked(rr, s, v);
    }

    /// Signatures must arrive in ascending signer order, so sort the two keys.
    function _quorum(ScryTypes.ObservationResult memory r) internal view returns (bytes[] memory sigs) {
        sigs = new bytes[](2);
        if (vm.addr(PRIMARY_KEY) < vm.addr(VERIFY_KEY)) {
            sigs[0] = _sign(PRIMARY_KEY, r);
            sigs[1] = _sign(VERIFY_KEY, r);
        } else {
            sigs[0] = _sign(VERIFY_KEY, r);
            sigs[1] = _sign(PRIMARY_KEY, r);
        }
    }

    function testQuorumSettlesTheMarketAfterTheChallengeWindow() public {
        _build();
        ScryTypes.ObservationResult memory r = Fixtures.result(MARKET, _ruleHash(), 214, "yes");
        resolver.propose(MARKET, r, _quorum(r));

        require(book.status(MARKET) == ScryTypes.MarketStatus.Open, "not settled while open to challenge");

        vm.warp(block.timestamp + CHALLENGE);
        resolver.finalize(MARKET);

        require(book.status(MARKET) == ScryTypes.MarketStatus.Resolved, "resolved");
        require(book.observedValue(MARKET) == 214, "value carried through");
        require(book.evidenceRoot(MARKET) == r.evidenceRoot, "evidence carried through");
    }

    function testAResultForAnotherRuleIsRefused() public {
        _build();
        // A perfectly valid reading, signed by real observers, but committing to
        // a rule this market was not opened with.
        ScryTypes.ObservationResult memory r = Fixtures.result(MARKET, keccak256("other rule"), 214, "yes");
        bytes[] memory sigs = _quorum(r);
        vm.expectRevert(ObservationResolver.RuleMismatch.selector);
        resolver.propose(MARKET, r, sigs);
    }

    function testAResultForAnotherMarketIsRefused() public {
        _build();
        // Signed by real observers under this market's rule, but naming another
        // market: a reading of one market must not settle a different one.
        ScryTypes.ObservationResult memory r = Fixtures.result("market-2", _ruleHash(), 214, "yes");
        bytes[] memory sigs = _quorum(r);
        vm.expectRevert(ObservationResolver.MarketMismatch.selector);
        resolver.propose(MARKET, r, sigs);
    }

    function testASignatureForAnotherDeploymentIsRefused() public {
        _build();
        ObservationResolver elsewhere = new ObservationResolver(address(this), OPERATOR, address(registry), CHALLENGE);
        ScryTypes.ObservationResult memory r = Fixtures.result(MARKET, _ruleHash(), 214, "yes");

        // Both real observers, the right market and rule, but signed over the
        // other resolver's domain, as a testnet deployment's would be.
        bytes[] memory sigs = new bytes[](2);
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(PRIMARY_KEY, elsewhere.digest(r));
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(VERIFY_KEY, elsewhere.digest(r));
        sigs[0] = abi.encodePacked(r1, s1, v1);
        sigs[1] = abi.encodePacked(r2, s2, v2);

        vm.expectRevert(ObservationResolver.NotAnObserver.selector);
        resolver.propose(MARKET, r, sigs);
    }

    function testOneObserverCannotReachQuorumAlone() public {
        _build();
        ScryTypes.ObservationResult memory r = Fixtures.result(MARKET, _ruleHash(), 214, "yes");
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _sign(PRIMARY_KEY, r);

        vm.expectRevert(ObservationResolver.TooFewSignatures.selector);
        resolver.propose(MARKET, r, sigs);
    }

    function testTheSameObserverSigningTwiceIsNotAQuorum() public {
        _build();
        ScryTypes.ObservationResult memory r = Fixtures.result(MARKET, _ruleHash(), 214, "yes");
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(PRIMARY_KEY, r);
        sigs[1] = _sign(PRIMARY_KEY, r);

        vm.expectRevert(ObservationResolver.SignaturesOutOfOrder.selector);
        resolver.propose(MARKET, r, sigs);
    }

    function testAStrangerSignatureIsRefused() public {
        _build();
        ScryTypes.ObservationResult memory r = Fixtures.result(MARKET, _ruleHash(), 214, "yes");
        bytes[] memory sigs = new bytes[](2);
        address stranger = vm.addr(STRANGER_KEY);
        address known = vm.addr(PRIMARY_KEY);
        if (stranger < known) {
            sigs[0] = _sign(STRANGER_KEY, r);
            sigs[1] = _sign(PRIMARY_KEY, r);
        } else {
            sigs[0] = _sign(PRIMARY_KEY, r);
            sigs[1] = _sign(STRANGER_KEY, r);
        }

        vm.expectRevert(ObservationResolver.NotAnObserver.selector);
        resolver.propose(MARKET, r, sigs);
    }

    function testNothingPaysOutBeforeTheChallengeWindowCloses() public {
        _build();
        ScryTypes.ObservationResult memory r = Fixtures.result(MARKET, _ruleHash(), 214, "yes");
        resolver.propose(MARKET, r, _quorum(r));

        vm.expectRevert(ObservationResolver.ChallengeOpen.selector);
        resolver.finalize(MARKET);
    }

    function testTheOperatorCanVoidAProposedResult() public {
        _build();
        ScryTypes.ObservationResult memory r = Fixtures.result(MARKET, _ruleHash(), 214, "yes");
        resolver.propose(MARKET, r, _quorum(r));

        vm.prank(OPERATOR);
        resolver.challenge(MARKET, "camera was frozen");

        require(book.status(MARKET) == ScryTypes.MarketStatus.Invalid, "voided");
        vm.prank(ALICE);
        require(book.refund(MARKET) == 100e6, "winner refunded, not paid");
    }

    function testALosingPositionCannotVoidTheResult() public {
        _build();
        ScryTypes.ObservationResult memory r = Fixtures.result(MARKET, _ruleHash(), 214, "yes");
        resolver.propose(MARKET, r, _quorum(r));

        // Bob backed "no". If this worked for anyone, every loser would file it.
        vm.prank(BOB);
        vm.expectRevert(ObservationResolver.NotOperator.selector);
        resolver.challenge(MARKET, "sore loser");
    }

    function testAChallengeArrivingLateIsRefused() public {
        _build();
        ScryTypes.ObservationResult memory r = Fixtures.result(MARKET, _ruleHash(), 214, "yes");
        resolver.propose(MARKET, r, _quorum(r));

        vm.warp(block.timestamp + CHALLENGE);
        vm.expectRevert(ObservationResolver.ChallengeClosed.selector);
        resolver.challenge(MARKET, "too late");
    }

    function testOnlyTheAdminReplacesTheOperator() public {
        _build();
        vm.prank(OPERATOR);
        vm.expectRevert(ObservationResolver.NotAdmin.selector);
        resolver.setOperator(BOB);
    }

    function testTheBookIsWiredOnceAndCannotBeMoved() public {
        _build();
        vm.expectRevert(ObservationResolver.BookAlreadySet.selector);
        resolver.setBook(address(0xDEAD));
    }

    function testAResultCannotBeProposedTwice() public {
        _build();
        ScryTypes.ObservationResult memory r = Fixtures.result(MARKET, _ruleHash(), 214, "yes");
        resolver.propose(MARKET, r, _quorum(r));

        ScryTypes.ObservationResult memory again = Fixtures.result(MARKET, _ruleHash(), 999, "no");
        bytes[] memory sigs = _quorum(again);
        vm.expectRevert(ObservationResolver.AlreadyProposed.selector);
        resolver.propose(MARKET, again, sigs);
    }

    /// A resolver that can never finalise would strand every market it settles.
    function testAResolverWithoutAChallengeWindowIsRefused() public {
        _build();
        vm.expectRevert(ObservationResolver.InvalidConfiguration.selector);
        new ObservationResolver(address(this), OPERATOR, address(registry), 0);
    }

    function testAResolverWithoutARegistryIsRefused() public {
        vm.expectRevert(ObservationResolver.InvalidConfiguration.selector);
        new ObservationResolver(address(this), OPERATOR, address(0), CHALLENGE);
    }

    function testTheAdminCanVoidAResultAsWellAsTheOperator() public {
        _build();
        ScryTypes.ObservationResult memory r = Fixtures.result(MARKET, _ruleHash(), 214, "yes");
        resolver.propose(MARKET, r, _quorum(r));

        resolver.challenge(MARKET, "admin pulled it");
        require(book.status(MARKET) == ScryTypes.MarketStatus.Invalid, "voided by the admin");
    }

    function testAStrangerCannotWireTheBook() public {
        _build();
        ObservationResolver fresh = new ObservationResolver(address(this), OPERATOR, address(registry), CHALLENGE);
        vm.prank(BOB);
        vm.expectRevert(ObservationResolver.NotAdmin.selector);
        fresh.setBook(address(book));
    }

    function testTheBookCannotBeWiredToNobody() public {
        _build();
        ObservationResolver fresh = new ObservationResolver(address(this), OPERATOR, address(registry), CHALLENGE);
        vm.expectRevert(ObservationResolver.InvalidConfiguration.selector);
        fresh.setBook(address(0));
    }

    function testTheOperatorCannotBeSetToNobody() public {
        _build();
        vm.expectRevert(ObservationResolver.InvalidConfiguration.selector);
        resolver.setOperator(address(0));
    }

    function testNothingCanBeProposedBeforeTheBookIsWired() public {
        _build();
        ObservationResolver fresh = new ObservationResolver(address(this), OPERATOR, address(registry), CHALLENGE);
        ScryTypes.ObservationResult memory r = Fixtures.result(MARKET, _ruleHash(), 214, "yes");
        bytes[] memory sigs = _quorum(r);
        vm.expectRevert(ObservationResolver.NoBook.selector);
        fresh.propose(MARKET, r, sigs);
    }

    function testNothingCanBeVoidedBeforeTheBookIsWired() public {
        _build();
        ObservationResolver fresh = new ObservationResolver(address(this), OPERATOR, address(registry), CHALLENGE);
        vm.prank(OPERATOR);
        vm.expectRevert(ObservationResolver.NoBook.selector);
        fresh.invalidate(MARKET, "no book");
    }

    /// An observer saying "this reading is no good" must void the market rather
    /// than settle it, so the resolver refuses to carry it as a result.
    function testAResultFlaggedInvalidIsNotAResult() public {
        _build();
        ScryTypes.ObservationResult memory r = Fixtures.result(MARKET, _ruleHash(), 214, "yes");
        r.invalid = true;
        bytes[] memory sigs = _quorum(r);
        vm.expectRevert(ObservationResolver.ResultMarkedInvalid.selector);
        resolver.propose(MARKET, r, sigs);
    }

    function testAVoidedResultCannotBeVoidedAgain() public {
        _build();
        ScryTypes.ObservationResult memory r = Fixtures.result(MARKET, _ruleHash(), 214, "yes");
        resolver.propose(MARKET, r, _quorum(r));

        vm.startPrank(OPERATOR);
        resolver.challenge(MARKET, "camera was frozen");
        vm.expectRevert(ObservationResolver.WrongStatus.selector);
        resolver.challenge(MARKET, "frozen again");
        vm.stopPrank();
    }

    function testAFinalisedResultCannotBeFinalisedAgain() public {
        _build();
        ScryTypes.ObservationResult memory r = Fixtures.result(MARKET, _ruleHash(), 214, "yes");
        resolver.propose(MARKET, r, _quorum(r));
        vm.warp(block.timestamp + CHALLENGE);
        resolver.finalize(MARKET);

        vm.expectRevert(ObservationResolver.WrongStatus.selector);
        resolver.finalize(MARKET);
    }

    function testAFinalisedResultCannotThenBeVoided() public {
        _build();
        ScryTypes.ObservationResult memory r = Fixtures.result(MARKET, _ruleHash(), 214, "yes");
        resolver.propose(MARKET, r, _quorum(r));
        vm.warp(block.timestamp + CHALLENGE);
        resolver.finalize(MARKET);

        vm.prank(OPERATOR);
        vm.expectRevert(ObservationResolver.WrongStatus.selector);
        resolver.invalidate(MARKET, "after the fact");
    }

    function testASignatureOfTheWrongLengthIsRefused() public {
        _build();
        ScryTypes.ObservationResult memory r = Fixtures.result(MARKET, _ruleHash(), 214, "yes");
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = hex"00";
        sigs[1] = _sign(PRIMARY_KEY, r);

        vm.expectRevert(ObservationResolver.NotAnObserver.selector);
        resolver.propose(MARKET, r, sigs);
    }

    /// Every signature has a mirror image with the same signer. Accepting the
    /// high half would let one observer's reading count twice toward quorum.
    function testTheMirrorImageOfASignatureIsRefused() public {
        _build();
        ScryTypes.ObservationResult memory r = Fixtures.result(MARKET, _ruleHash(), 214, "yes");
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(PRIMARY_KEY, resolver.digest(r));
        uint256 order = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

        bytes[] memory sigs = new bytes[](2);
        sigs[0] = abi.encodePacked(rr, bytes32(order - uint256(s)), uint8(v == 27 ? 28 : 27));
        sigs[1] = _sign(VERIFY_KEY, r);

        vm.expectRevert(ObservationResolver.NotAnObserver.selector);
        resolver.propose(MARKET, r, sigs);
    }

    function testASignatureThatRecoversToNobodyIsRefused() public {
        _build();
        ScryTypes.ObservationResult memory r = Fixtures.result(MARKET, _ruleHash(), 214, "yes");
        (, bytes32 rr, bytes32 s) = vm.sign(PRIMARY_KEY, resolver.digest(r));

        bytes[] memory sigs = new bytes[](2);
        // v is carried as signed, not normalised, so an impossible one recovers
        // to nobody rather than to whoever the caller hoped.
        sigs[0] = abi.encodePacked(rr, s, uint8(29));
        sigs[1] = _sign(VERIFY_KEY, r);

        vm.expectRevert(ObservationResolver.NotAnObserver.selector);
        resolver.propose(MARKET, r, sigs);
    }

    function testAStrangerCannotVoidAMarket() public {
        _build();
        vm.prank(ALICE);
        vm.expectRevert(ObservationResolver.NotOperator.selector);
        resolver.invalidate(MARKET, "not yours to void");
    }

    /// The API reads these two to decide whether a result is ready to finalize,
    /// and it encodes the calls by hand, so what they answer is pinned here.
    function testAProposalReportsItsStatusAndDeadline() public {
        _build();
        ScryTypes.ObservationResult memory r = Fixtures.result(MARKET, _ruleHash(), 214, "yes");
        resolver.propose(MARKET, r, _quorum(r));

        require(
            resolver.observationStatus(MARKET) == ScryTypes.ObservationStatus.Proposed,
            "proposed while the challenge window runs"
        );
        require(resolver.challengeEndsAt(MARKET) == LOCKS_AT + CHALLENGE, "deadline is the window from the proposal");

        vm.warp(LOCKS_AT + CHALLENGE);
        resolver.finalize(MARKET);
        require(resolver.observationStatus(MARKET) == ScryTypes.ObservationStatus.Final, "final once settled");
    }

    /// Two deployments must not share a domain, or a signature gathered on a
    /// testnet would settle the same market on mainnet.
    function testEachResolverSignsUnderItsOwnDomain() public {
        _build();
        ObservationResolver elsewhere = new ObservationResolver(address(this), OPERATOR, address(registry), CHALLENGE);
        require(resolver.domainSeparator() != elsewhere.domainSeparator(), "domains differ by address");
    }
}
