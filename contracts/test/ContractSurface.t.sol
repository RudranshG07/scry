pragma solidity 0.8.30;

import {ScryTypes} from "../src/ScryTypes.sol";
import {IMarketFactory} from "../src/interfaces/IMarketFactory.sol";
import {IPooledMarket} from "../src/interfaces/IPooledMarket.sol";
import {IObservationResolver} from "../src/interfaces/IObservationResolver.sol";

contract ContractSurfaceTest {
    function testLifecycleOrdering() public pure {
        require(uint8(ScryTypes.MarketStatus.Scheduled) == 0);
        require(uint8(ScryTypes.MarketStatus.Resolved) == 6);
        require(uint8(ScryTypes.MarketStatus.Invalid) == 7);
    }

    function testCoreSelectorsRemainDistinct() public pure {
        require(IMarketFactory.createMarket.selector != IPooledMarket.deposit.selector);
        require(IPooledMarket.resolve.selector != IObservationResolver.propose.selector);
        require(IObservationResolver.finalize.selector != IObservationResolver.invalidate.selector);
    }
}
