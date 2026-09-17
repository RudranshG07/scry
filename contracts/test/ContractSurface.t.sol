pragma solidity 0.8.30;

import {ScryTypes} from "../src/ScryTypes.sol";
import {IMarketBook} from "../src/interfaces/IMarketBook.sol";
import {IObservationResolver} from "../src/interfaces/IObservationResolver.sol";

contract ContractSurfaceTest {
    function testLifecycleOrdering() public pure {
        require(uint8(ScryTypes.MarketStatus.Scheduled) == 0);
        require(uint8(ScryTypes.MarketStatus.Resolved) == 6);
        require(uint8(ScryTypes.MarketStatus.Invalid) == 7);
    }

    function testCoreSelectorsRemainDistinct() public pure {
        require(IMarketBook.createMarket.selector != IMarketBook.deposit.selector);
        require(IMarketBook.resolve.selector != IObservationResolver.propose.selector);
        require(IObservationResolver.finalize.selector != IObservationResolver.invalidate.selector);
    }

    /// Everything is keyed by market id rather than by a market's own address:
    /// there is one contract and it holds them all. The API and the site encode
    /// these calls by hand, so the shapes are pinned here.
    function testEveryCallNamesItsMarketById() public pure {
        require(IMarketBook.deposit.selector == bytes4(keccak256("deposit(bytes32,bytes32,uint256)")));
        require(IMarketBook.claim.selector == bytes4(keccak256("claim(bytes32)")));
        require(IMarketBook.refund.selector == bytes4(keccak256("refund(bytes32)")));
        require(IMarketBook.poolFor.selector == bytes4(keccak256("poolFor(bytes32,bytes32)")));
        require(IObservationResolver.finalize.selector == bytes4(keccak256("finalize(bytes32)")));
        require(IObservationResolver.invalidate.selector == bytes4(keccak256("invalidate(bytes32,bytes32)")));
    }
}
