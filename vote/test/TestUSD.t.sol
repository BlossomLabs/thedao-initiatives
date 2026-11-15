// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {TestUSD} from "../contracts/TestUSD.sol";
import {SignedBallots} from "../contracts/SignedBallots.sol";

/// The test vote's dollar: anyone mints up to a million at a time, and the round counts
/// it at $1 on an initiative's account.
contract TestUSDTest is Test {
    function test_anyoneMintsUpToTheCap() public {
        TestUSD t = new TestUSD();
        assertEq(t.decimals(), 6);
        vm.prank(address(0xBEEF));
        t.mint(address(0xBEEF), 1_000_000e6);
        assertEq(t.balanceOf(address(0xBEEF)), 1_000_000e6);
        vm.expectRevert(TestUSD.MintTooLarge.selector);
        t.mint(address(0xBEEF), 1_000_000e6 + 1);
    }

    function test_aDonationLowersTheAsk() public {
        TestUSD t = new TestUSD();
        SignedBallots.Schedule memory s;
        s.opensAt = uint64(block.timestamp + 100);
        s.initialWindow = 320;
        s.maxWindows = 4;
        s.firstTallyAt[0] = s.opensAt + 30 minutes;
        s.firstTallyAt[1] = s.firstTallyAt[0] + 600;
        s.firstTallyAt[2] = s.firstTallyAt[1] + 600;
        SignedBallots round = new SignedBallots(address(this), address(0), "Voter", "VOTE", s);
        round.addInitiative(address(0x1000), 250_000e6, false, 0);
        round.registerCurrency(address(t), address(0));
        round.setPledge(bytes32(uint256(1)), 0, 0, 10_000e6);
        t.mint(address(0x1000), 40_000e6);
        (,,, uint256 ask) = round.initiativeUsd(0);
        assertEq(ask, 200_000e6);
        assertEq(round.maximumTierDuration(), 600);
    }
}
