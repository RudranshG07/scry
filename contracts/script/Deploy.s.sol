pragma solidity 0.8.30;

import {MarketFactory} from "../src/MarketFactory.sol";
import {ObservationResolver} from "../src/ObservationResolver.sol";
import {ObserverRegistry} from "../src/ObserverRegistry.sol";
import {ReputationCheckpoint} from "../src/ReputationCheckpoint.sol";
import {DevUSDC} from "../src/DevUSDC.sol";

interface VmLike {
    function envAddress(string calldata name) external view returns (address);
    function envOr(string calldata name, uint256 fallbackTo) external view returns (uint256);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @notice Deploys the settlement stack to Base or Polygon.
///
/// The USDC address is chosen by chain id rather than passed in: escrowing the
/// wrong token does not show up until someone tries to withdraw.
contract Deploy {
    VmLike constant vm = VmLike(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    uint256 constant BASE = 8453;
    uint256 constant BASE_SEPOLIA = 84532;
    uint256 constant POLYGON = 137;
    uint256 constant POLYGON_AMOY = 80002;
    uint256 constant ANVIL = 31337;

    // Polygon runs two USDCs; Polymarket settles in the bridged USDC.e.
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
        if (chainId == POLYGON) return POLYGON_USDC_E;
        if (chainId == BASE_SEPOLIA) return BASE_SEPOLIA_USDC;
        if (chainId == POLYGON_AMOY) return POLYGON_AMOY_USDC;
        revert UnsupportedChain(chainId);
    }

    function run()
        external
        returns (
            ObserverRegistry registry,
            ObservationResolver resolver,
            MarketFactory factory,
            ReputationCheckpoint reputation
        )
    {
        address admin = vm.envAddress("SCRY_ADMIN");
        uint8 threshold = uint8(vm.envOr("SCRY_SIGNATURE_THRESHOLD", uint256(2)));
        uint64 challengeWindow = uint64(vm.envOr("SCRY_CHALLENGE_WINDOW", uint256(10 minutes)));

        vm.startBroadcast();

        // Inside the broadcast, not before it. Creating the token above only
        // computed an address in simulation: nothing was deployed, and the
        // factory happily stored a collateral that was not a contract. The
        // first deposit reverted on a call to nothing.
        address collateral = collateralFor(block.chainid);

        registry = new ObserverRegistry(admin, threshold);
        resolver = new ObservationResolver(admin, address(registry), challengeWindow);
        factory = new MarketFactory(admin, collateral, address(resolver));
        reputation = new ReputationCheckpoint(admin);

        vm.stopBroadcast();
    }
}
