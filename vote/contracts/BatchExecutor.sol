// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice EIP-7702 delegate for an EOA's own atomic batches: the account sends one
///         transaction to itself and every call runs with the account as msg.sender.
///         Nobody else can execute through it. Any failing call reverts the batch.
contract BatchExecutor {
    struct Call {
        address to;
        uint256 value;
        bytes data;
    }

    error NotSelf();
    error CallFailed(uint256 index, bytes reason);

    function execute(Call[] calldata calls) external payable {
        if (msg.sender != address(this)) revert NotSelf();
        for (uint256 i; i < calls.length; ++i) {
            (bool ok, bytes memory reason) = calls[i].to.call{value: calls[i].value}(calls[i].data);
            if (!ok) revert CallFailed(i, reason);
        }
    }

    /// Plain ETH transfers (funding the relayer) keep working while delegated.
    receive() external payable {}
}
