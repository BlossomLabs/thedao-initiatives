// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice A test vote's dollar (Sepolia only): six decimals like USDC, and anyone may
///         mint some, so testers can donate. Worth nothing; the round values it at $1.
contract TestUSD is ERC20 {
    /// @notice The most one mint gives: a million test dollars.
    uint256 public constant MAX_MINT = 1_000_000e6;

    error MintTooLarge();

    constructor() ERC20("Test USD", "tUSD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        if (amount > MAX_MINT) revert MintTooLarge();
        _mint(to, amount);
    }
}
