pragma solidity 0.8.30;

import {MarketBook} from "../src/MarketBook.sol";
import {ObservationResolver} from "../src/ObservationResolver.sol";
import {ObserverRegistry} from "../src/ObserverRegistry.sol";
import {ReputationCheckpoint} from "../src/ReputationCheckpoint.sol";
import {DevUSDC} from "../src/DevUSDC.sol";

interface VmLike {
    function envAddress(string calldata name) external view returns (address);
    function envOr(string calldata name, uint256 fallbackTo) external view returns (uint256);
    function envOr(string calldata name, address fallbackTo) external view returns (address);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @notice Deploys the settlement stack to Base or Polygon.
///
/// The USDC address is chosen by chain id rather than passed in: escrowing the
/// wrong token does not show up until someone tries to withdraw.
///
/// SCRY_ADMIN should be a Safe. It alone registers observers, and whoever
/// registers observers can settle every market. SCRY_OPERATOR is the server's
/// hot key: it opens markets and can void or pause them, none of which moves
/// money anywhere but back to the people who staked it.
contract Deploy {
    VmLike constant vm = VmLike(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    uint256 constant BASE = 8453;
    uint256 constant BASE_SEPOLIA = 84532;
    uint256 constant POLYGON = 137;
    uint256 constant POLYGON_AMOY = 80002;
    uint256 constant ANVIL = 31337;

    // Polygon runs two USDCs. Scry settles in Circle's native one, which is what
    // an exchange sends when somebody withdraws USDC to Polygon. The bridged
    // USDC.e below is a different contract, the one Polymarket settles in, and
    // money sent to the wrong one never appears. SCRY_COLLATERAL overrides this.
    address constant POLYGON_USDC = 0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359;
    address constant POLYGON_USDC_E = 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174;
    address constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant BASE_SEPOLIA_USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    address constant POLYGON_AMOY_USDC = 0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582;

    error UnsupportedChain(uint256 chainId);

    /// @dev Anvil only. A token anyone can mint is the whole point on a
    /// throwaway chain and is why this is unreachable on any other.
    function collateralFor(uint256 chainId) public returns (address) {
        if (chainId == ANVIL) return address(new DevUSDC());
        return knownCollateral(chainId);
    }

    function knownCollateral(uint256 chainId) public pure returns (address) {
        if (chainId == BASE) return BASE_USDC;
        if (chainId == POLYGON) return POLYGON_USDC;
        if (chainId == BASE_SEPOLIA) return BASE_SEPOLIA_USDC;
        if (chainId == POLYGON_AMOY) return POLYGON_AMOY_USDC;
        revert UnsupportedChain(chainId);
    }

    function run()
        external
        returns (
            ObserverRegistry registry,
            ObservationResolver resolver,
            MarketBook book,
            ReputationCheckpoint reputation
        )
    {
        address admin = vm.envAddress("SCRY_ADMIN");
        address operator = vm.envAddress("SCRY_OPERATOR");
        uint8 threshold = uint8(vm.envOr("SCRY_SIGNATURE_THRESHOLD", uint256(2)));
        uint64 challengeWindow = uint64(vm.envOr("SCRY_CHALLENGE_WINDOW", uint256(10 minutes)));
        // Six decimals. Low on purpose until the contracts have been audited.
        uint256 maxPool = vm.envOr("SCRY_MAX_POOL", uint256(1_000e6));
        uint256 maxStake = vm.envOr("SCRY_MAX_STAKE", uint256(100e6));
        address named = vm.envOr("SCRY_COLLATERAL", address(0));

        vm.startBroadcast();

        // Inside the broadcast, not before it. Creating the token above only
        // computed an address in simulation: nothing was deployed, and the book
        // happily stored a collateral that was not a contract. The first deposit
        // reverted on a call to nothing.
        address collateral = named == address(0) ? collateralFor(block.chainid) : named;

        registry = new ObserverRegistry(admin, threshold);
        resolver = new ObservationResolver(admin, operator, address(registry), challengeWindow);
        book = new MarketBook(admin, operator, collateral, address(resolver), maxPool, maxStake);
        // The resolver comes first because the book is constructed with its
        // address, so this is the one call that ties the two together. It can be
        // made once, by whoever deployed the resolver, and neither contract can
        // be pointed anywhere else afterwards.
        resolver.setBook(address(book));
        reputation = new ReputationCheckpoint(admin);

        vm.stopBroadcast();
    }
}
