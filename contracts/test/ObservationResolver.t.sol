pragma solidity 0.8.30;

import {ObservationResolver} from "../src/ObservationResolver.sol";
import {ObserverRegistry} from "../src/ObserverRegistry.sol";
import {PooledMarket} from "../src/PooledMarket.sol";
import {ScryTypes} from "../src/ScryTypes.sol";
import {Fixtures, SilentUSDC, vm} from "./Harness.sol";

contract ObservationResolverTest {
    SilentUSDC usdc;
    ObserverRegistry registry;
    ObservationResolver resolver;
    PooledMarket market;

    uint256 constant PRIMARY_KEY = 0xA1;
    uint256 constant VERIFY_KEY = 0xB2;
    uint256 constant STRANGER_KEY = 0xC3;

    uint64 constant LOCKS_AT = 2_000_000_000;
    uint64 constant CHALLENGE = 600;
    bytes32 constant RULE_HASH = keccak256("rule");
    address constant OPERATOR = address(0xC0FFEE);
    address constant ALICE = address(0xA11CE);
    address constant BOB = address(0xB0B);

    // The market reads its limits from its factory; this test stands in for it.
    bool public depositsPaused;
    uint256 public maxPool = 10_000e6;
    uint256 public maxStake = 1_000e6;

    function _build() internal {
        usdc = new SilentUSDC();
        registry = new ObserverRegistry(address(this), 1);
        registry.setObserver(vm.addr(PRIMARY_KEY), true);
        registry.setObserver(vm.addr(VERIFY_KEY), true);
        registry.setSignatureThreshold(2);

        resolver = new ObservationResolver(address(this), OPERATOR, address(registry), CHALLENGE);

        bytes32[] memory ids = new bytes32[](2);
        ids[0] = "yes";
        ids[1] = "no";
        market = new PooledMarket(
            address(this), address(usdc), address(resolver), RULE_HASH, "market-1", LOCKS_AT, LOCKS_AT + 240, ids
        );

        vm.warp(LOCKS_AT - 100);
        _stake(ALICE, "yes", 100e6);
        _stake(BOB, "no", 100e6);
        vm.warp(LOCKS_AT);
        market.lock();
    }

    function _stake(address who, bytes32 outcome, uint256 amount) internal {
        usdc.mint(who, amount);
        vm.startPrank(who);
        usdc.approve(address(market), amount);
        market.deposit(outcome, amount);
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
        ScryTypes.ObservationResult memory r = Fixtures.result("market-1", RULE_HASH, 214, "yes");
        resolver.propose(address(market), r, _quorum(r));

        require(market.status() == ScryTypes.MarketStatus.Observing, "not settled while open to challenge");

        vm.warp(block.timestamp + CHALLENGE);
        resolver.finalize(address(market));

        require(market.status() == ScryTypes.MarketStatus.Resolved, "resolved");
        require(market.observedValue() == 214, "value carried through");
        require(market.evidenceRoot() == r.evidenceRoot, "evidence carried through");
    }

    function testAResultForAnotherRuleIsRefused() public {
        _build();
        // A perfectly valid reading, signed by real observers, but committing to
        // a rule this market was not created with.
        ScryTypes.ObservationResult memory r = Fixtures.result("market-1", keccak256("other rule"), 214, "yes");
        bytes[] memory sigs = _quorum(r);
        vm.expectRevert(ObservationResolver.RuleMismatch.selector);
        resolver.propose(address(market), r, sigs);
    }

    function testAResultForAnotherMarketIsRefused() public {
        _build();
        // Signed by real observers under this market's rule, but naming a
        // different market: a reading of one market must not settle another.
        ScryTypes.ObservationResult memory r = Fixtures.result("market-2", RULE_HASH, 214, "yes");
        bytes[] memory sigs = _quorum(r);
        vm.expectRevert(ObservationResolver.MarketMismatch.selector);
        resolver.propose(address(market), r, sigs);
    }

    function testASignatureForAnotherDeploymentIsRefused() public {
        _build();
        ObservationResolver elsewhere = new ObservationResolver(address(this), OPERATOR, address(registry), CHALLENGE);
        ScryTypes.ObservationResult memory r = Fixtures.result("market-1", RULE_HASH, 214, "yes");

        // Both real observers, the right market and rule, but signed over the
        // other resolver's domain, as a testnet deployment's would be.
        bytes[] memory sigs = new bytes[](2);
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(PRIMARY_KEY, elsewhere.digest(r));
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(VERIFY_KEY, elsewhere.digest(r));
        sigs[0] = abi.encodePacked(r1, s1, v1);
        sigs[1] = abi.encodePacked(r2, s2, v2);

        vm.expectRevert(ObservationResolver.NotAnObserver.selector);
        resolver.propose(address(market), r, sigs);
    }

    function testOneObserverCannotReachQuorumAlone() public {
        _build();
        ScryTypes.ObservationResult memory r = Fixtures.result("market-1", RULE_HASH, 214, "yes");
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _sign(PRIMARY_KEY, r);

        vm.expectRevert(ObservationResolver.TooFewSignatures.selector);
        resolver.propose(address(market), r, sigs);
    }

    function testTheSameObserverSigningTwiceIsNotAQuorum() public {
        _build();
        ScryTypes.ObservationResult memory r = Fixtures.result("market-1", RULE_HASH, 214, "yes");
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(PRIMARY_KEY, r);
        sigs[1] = _sign(PRIMARY_KEY, r);

        vm.expectRevert(ObservationResolver.SignaturesOutOfOrder.selector);
        resolver.propose(address(market), r, sigs);
    }

    function testAStrangerSignatureIsRefused() public {
        _build();
        ScryTypes.ObservationResult memory r = Fixtures.result("market-1", RULE_HASH, 214, "yes");
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
        resolver.propose(address(market), r, sigs);
    }

    function testNothingPaysOutBeforeTheChallengeWindowCloses() public {
        _build();
        ScryTypes.ObservationResult memory r = Fixtures.result("market-1", RULE_HASH, 214, "yes");
        resolver.propose(address(market), r, _quorum(r));

        vm.expectRevert(ObservationResolver.ChallengeOpen.selector);
        resolver.finalize(address(market));
    }

    function testTheOperatorCanVoidAProposedResult() public {
        _build();
        ScryTypes.ObservationResult memory r = Fixtures.result("market-1", RULE_HASH, 214, "yes");
        resolver.propose(address(market), r, _quorum(r));

        vm.prank(OPERATOR);
        resolver.challenge(address(market), "camera was frozen");

        require(market.status() == ScryTypes.MarketStatus.Invalid, "voided");
        vm.prank(ALICE);
        require(market.refund() == 100e6, "winner refunded, not paid");
    }

    function testALosingPositionCannotVoidTheResult() public {
        _build();
        ScryTypes.ObservationResult memory r = Fixtures.result("market-1", RULE_HASH, 214, "yes");
        resolver.propose(address(market), r, _quorum(r));

        // Bob backed "no". If this worked for anyone, every loser would file it.
        vm.prank(BOB);
        vm.expectRevert(ObservationResolver.NotOperator.selector);
        resolver.challenge(address(market), "sore loser");
    }

    function testAChallengeArrivingLateIsRefused() public {
        _build();
        ScryTypes.ObservationResult memory r = Fixtures.result("market-1", RULE_HASH, 214, "yes");
        resolver.propose(address(market), r, _quorum(r));

        vm.warp(block.timestamp + CHALLENGE);
        vm.expectRevert(ObservationResolver.ChallengeClosed.selector);
        resolver.challenge(address(market), "too late");
    }

    function testOnlyTheAdminReplacesTheOperator() public {
        _build();
        vm.prank(OPERATOR);
        vm.expectRevert(ObservationResolver.NotAdmin.selector);
        resolver.setOperator(BOB);
    }

    function testAResultCannotBeProposedTwice() public {
        _build();
        ScryTypes.ObservationResult memory r = Fixtures.result("market-1", RULE_HASH, 214, "yes");
        resolver.propose(address(market), r, _quorum(r));

        ScryTypes.ObservationResult memory again = Fixtures.result("market-1", RULE_HASH, 999, "no");
        bytes[] memory sigs = _quorum(again);
        vm.expectRevert(ObservationResolver.AlreadyProposed.selector);
        resolver.propose(address(market), again, sigs);
    }
}
