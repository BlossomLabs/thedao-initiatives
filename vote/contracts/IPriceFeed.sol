// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev The Chainlink AggregatorV3 methods consumed by the accounting views.
interface IPriceFeed {
    function decimals() external view returns (uint8);

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
