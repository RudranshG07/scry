pragma solidity 0.8.30;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @notice USDC on both Base and Polygon predates the ERC20 return-value rule
/// and some deployments return nothing at all. Treating an empty return as
/// failure would reject a transfer that actually happened, so success means an
/// empty return or an explicit true, and nothing else.
library SafeTransfer {
    error TransferFailed();

    function send(IERC20 token, address to, uint256 amount) internal {
        (bool ok, bytes memory data) = address(token).call(abi.encodeCall(IERC20.transfer, (to, amount)));
        _require(ok, data);
    }

    function pull(IERC20 token, address from, address to, uint256 amount) internal {
        (bool ok, bytes memory data) =
            address(token).call(abi.encodeCall(IERC20.transferFrom, (from, to, amount)));
        _require(ok, data);
    }

    function _require(bool ok, bytes memory data) private pure {
        if (!ok) revert TransferFailed();
        if (data.length != 0 && !abi.decode(data, (bool))) revert TransferFailed();
    }
}
