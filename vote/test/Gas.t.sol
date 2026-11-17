// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {SignedBallots} from "../contracts/SignedBallots.sol";
import {MockToken, MockFeed} from "./helpers/Fixtures.sol";

/// Gas of vote() with the three-currency baseline (ETH + feed, USDC fixed $1, EURC + feed),
/// 80 initiatives each holding all three and an open USD pledge.
contract GasTest is Test {
    uint256 constant M = 80;
    address voter = vm.addr(1000);
    SignedBallots round;

    function setUp() public {
        vm.warp(1_000_000);
        SignedBallots.Schedule memory s;
        s.opensAt = uint64(block.timestamp + 100);
        s.initialWindow = 1 days;
        s.maxWindows = 4;
        s.firstTallyAt[0] = s.opensAt + 7 days;
        s.firstTallyAt[1] = s.firstTallyAt[0] + 3 days;
        s.firstTallyAt[2] = s.firstTallyAt[1] + 3 days;
        round = new SignedBallots(address(this), address(0), "Voter", "VOTE", s);
        MockToken usdc = new MockToken(6);
        MockToken eurc = new MockToken(6);
        round.registerCurrency(address(0), address(new MockFeed(8, 3_000e8)));
        round.registerCurrency(address(usdc), address(0));
        round.registerCurrency(address(eurc), address(new MockFeed(8, 1.08e8)));
        for (uint256 i; i < M; ++i) {
            address a = address(uint160(0x10000 + i));
            round.addInitiative(a, 100_000e6, false, 0);
            vm.deal(a, 1 ether);
            usdc.mint(a, 1_000e6);
            eurc.mint(a, 500e6);
            round.setPledge(bytes32(i + 1), i, 0, 2_000e6);
        }
        round.mint(voter, 1);
        round.setPoolUsd(10_000e6);
        vm.warp(round.opensAt());
    }

    function ballotOf(uint256 placed) internal pure returns (bytes memory b) {
        b = new bytes(M);
        uint256 a = (placed - 3) / 2;
        for (uint256 i; i < M; ++i) {
            b[i] = bytes1(uint8(i < 3 ? 1 : i < 3 + a ? 4 : i < placed ? 4 + a : 255));
        }
    }

    /// First send and a revision of a ballot placing `placed` of the 80 projects. Meaningful
    /// under `forge test --isolate` (each call its own transaction, cold slots); without it
    /// the same calls share warm slots and only get cheaper.
    function measure(uint256 placed) internal returns (uint256 first, uint256 again) {
        uint8[] memory proof = new uint8[](3);
        (proof[0], proof[1], proof[2]) = (0, 1, 2);
        bytes memory b = ballotOf(placed);
        vm.prank(voter);
        round.vote(1, 1, b, proof);
        first = vm.lastCallGas().gasTotalUsed;
        vm.prank(voter);
        round.vote(1, 2, b, proof);
        again = vm.lastCallGas().gasTotalUsed;
        console.log("placed", placed, "first", first);
        console.log("placed", placed, "revision", again);
    }

    function test_gas10() public {
        (uint256 first, uint256 again) = measure(10);
        assertLt(first, 1_000_000);
        assertLt(again, 900_000);
    }

    function test_gas40() public {
        (uint256 first, uint256 again) = measure(40);
        assertLt(first, 1_500_000);
        assertLt(again, 1_400_000);
    }

    function test_gas80() public {
        (uint256 first, uint256 again) = measure(80);
        assertLt(first, 3_000_000);
        assertLt(again, 2_900_000);
    }
}
