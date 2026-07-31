pragma solidity 0.8.30;

import {MarketFactory} from "../src/MarketFactory.sol";
import {ObserverRegistry} from "../src/ObserverRegistry.sol";
import {PooledMarket} from "../src/PooledMarket.sol";
import {ScryTypes} from "../src/ScryTypes.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {Fixtures, SilentUSDC, vm} from "./Harness.sol";

contract MarketFactoryTest {
    SilentUSDC usdc;
    MarketFactory factory;

    address constant RESOLVER = address(0xBEEF);
    address constant ALICE = address(0xA11CE);
    uint64 constant LOCKS_AT = 2_000_000_000;

    function _build() internal {
        usdc = new SilentUSDC();
        factory = new MarketFactory(address(this), address(usdc), RESOLVER);
        vm.warp(LOCKS_AT - 1000);
    }

    function testCreatesAMarketCommittedToItsRule() public {
        _build();
        ScryTypes.MarketRule memory r = Fixtures.rule("market-1", LOCKS_AT);
        address m = factory.createMarket(r, Fixtures.bands(180), 0);

        require(m != address(0), "deployed");
        require(factory.marketFor("market-1") == m, "indexed");
        require(PooledMarket(m).ruleHash() == r.ruleHash, "rule committed before anyone can enter");
        require(PooledMarket(m).locksAt() == LOCKS_AT, "window carried through");
    }

    function testTheSameMarketCannotBeCreatedTwice() public {
        _build();
        ScryTypes.MarketRule memory r = Fixtures.rule("market-1", LOCKS_AT);
        ScryTypes.Outcome[] memory bands = Fixtures.bands(180);
        factory.createMarket(r, bands, 0);

        vm.expectRevert(MarketFactory.MarketExists.selector);
        factory.createMarket(r, bands, 0);
    }

    function testOverlappingBandsAreRefused() public {
        _build();
        ScryTypes.MarketRule memory r = Fixtures.rule("market-1", LOCKS_AT);

        // Both bands contain 120, so a count of 120 would win twice. A market
        // like this could only ever invalidate.
        ScryTypes.Outcome[] memory bad = new ScryTypes.Outcome[](2);
        bad[0] = ScryTypes.Outcome("yes", "Yes", 100, 0, true, false);
        bad[1] = ScryTypes.Outcome("no", "No", 0, 150, false, true);

        vm.expectRevert(MarketFactory.OutcomeBandsOverlap.selector);
        factory.createMarket(r, bad, 0);
    }

    function testAWindowThatRunsBackwardsIsRefused() public {
        _build();
        ScryTypes.MarketRule memory r = Fixtures.rule("market-1", LOCKS_AT);
        r.observationEndsAt = r.observationStartsAt - 1;

        vm.expectRevert(MarketFactory.BadWindow.selector);
        factory.createMarket(r, Fixtures.bands(180), 0);
    }

    function testASingleOutcomeIsNotAMarket() public {
        _build();
        ScryTypes.MarketRule memory r = Fixtures.rule("market-1", LOCKS_AT);
        ScryTypes.Outcome[] memory one = new ScryTypes.Outcome[](1);
        one[0] = ScryTypes.Outcome("yes", "Yes", 0, 0, false, false);

        vm.expectRevert(MarketFactory.TooFewOutcomes.selector);
        factory.createMarket(r, one, 0);
    }

    function testSeedLiquidityIsPaidOutToWinnersNotStranded() public {
        _build();
        usdc.mint(address(this), 50e6);
        usdc.approve(address(factory), 50e6);

        ScryTypes.MarketRule memory r = Fixtures.rule("market-1", LOCKS_AT);
        PooledMarket m = PooledMarket(factory.createMarket(r, Fixtures.bands(180), 50e6));

        require(m.sponsorPool() == 50e6, "seed recorded");
        require(m.totalPool() == 50e6, "seed joins the pool winners divide");

        usdc.mint(ALICE, 100e6);
        vm.startPrank(ALICE);
        usdc.approve(address(m), 100e6);
        m.deposit("yes", 100e6);
        vm.stopPrank();

        vm.warp(LOCKS_AT);
        m.lock();
        vm.prank(RESOLVER);
        m.resolve("yes", 214, keccak256("e"));

        vm.prank(ALICE);
        uint256 paid = m.claim();
        // Sole winner takes her stake and the seed with it.
        require(paid == 150e6, "seed reached the winner");
        require(usdc.balanceOf(address(m)) == 0, "nothing stranded");
    }

    function testTheSponsorTakesTheSeedBackIfTheMarketVoids() public {
        _build();
        usdc.mint(address(this), 50e6);
        usdc.approve(address(factory), 50e6);

        ScryTypes.MarketRule memory r = Fixtures.rule("market-1", LOCKS_AT);
        PooledMarket m = PooledMarket(factory.createMarket(r, Fixtures.bands(180), 50e6));

        usdc.mint(ALICE, 100e6);
        vm.startPrank(ALICE);
        usdc.approve(address(m), 100e6);
        m.deposit("yes", 100e6);
        vm.stopPrank();

        vm.warp(LOCKS_AT);
        m.lock();
        vm.prank(RESOLVER);
        m.invalidate("observers disagreed");

        vm.prank(ALICE);
        require(m.refund() == 100e6, "stake back");
        require(m.reclaimSeed() == 50e6, "seed back to the sponsor");
        require(usdc.balanceOf(address(m)) == 0, "nothing stranded");
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
}

contract DeployTest {
    Deploy d;

    function testCollateralIsPinnedPerChain() public {
        d = new Deploy();
        // Polygon must resolve to bridged USDC.e, the token Polymarket settles
        // in. Native USDC on Polygon is a different contract entirely.
        require(d.collateralFor(137) == 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174, "polygon USDC.e");
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
