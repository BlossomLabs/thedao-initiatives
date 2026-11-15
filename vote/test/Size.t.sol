// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {SignedBallots} from "../contracts/SignedBallots.sol";

/// The deployed round must fit EIP-170; a contract over the limit cannot be deployed on mainnet.
contract SizeTest is Test {
    function test_RuntimeFitsEip170() public {
        SignedBallots.Schedule memory s;
        s.opensAt = uint64(block.timestamp + 100);
        s.initialWindow = 1 days;
        s.maxWindows = 4;
        s.firstTallyAt[0] = s.opensAt + 7 days;
        s.firstTallyAt[1] = s.firstTallyAt[0] + 3 days;
        s.firstTallyAt[2] = s.firstTallyAt[1] + 3 days;
        SignedBallots round = new SignedBallots(address(this), address(0), "Voter", "VOTE", s);
        assertLe(address(round).code.length, 24_576);
    }
}
