pragma solidity 0.8.30;

import {ScryTypes} from "../ScryTypes.sol";

interface IMarketFactory {
    event MarketCreated(bytes32 indexed marketId, address indexed market, bytes32 indexed streamId, bytes32 ruleHash);

    function createMarket(
        ScryTypes.MarketRule calldata rule,
        ScryTypes.Outcome[] calldata outcomes,
        uint256 sponsorReward
    ) external returns (address market);

    function marketFor(bytes32 marketId) external view returns (address);
    function collateral() external view returns (address);
    function resolver() external view returns (address);
}
