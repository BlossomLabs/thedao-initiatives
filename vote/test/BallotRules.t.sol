// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {SignedBallots} from "../contracts/SignedBallots.sol";
import {RoundAccounting} from "../contracts/RoundAccounting.sol";

/// @notice The ballot rules (docs/superpowers/specs/2026-11-11-ballot-rules-design.md):
///         the contract agrees with vote/reference/ballot_rules.py on every shared
///         fixture, and new projects can join only outside the quiet-ending spans.
contract BallotRulesTest is Test {
    address internal voter = vm.addr(1000);

    function schedule() internal view returns (SignedBallots.Schedule memory s) {
        s.opensAt = uint64(block.timestamp + 100);
        s.initialWindow = 1 days;
        s.maxWindows = 4;
        s.firstTallyAt[0] = s.opensAt + 7 days;
        s.firstTallyAt[1] = s.firstTallyAt[0] + 3 days;
        s.firstTallyAt[2] = s.firstTallyAt[1] + 3 days;
    }

    function fresh() internal returns (SignedBallots round) {
        vm.warp(1_000_000);
        round = new SignedBallots(address(this), address(0), "Voter", "VOTE", schedule());
        round.mint(voter, 1);
    }

    function proof3(uint8 a, uint8 b, uint8 c) internal pure returns (uint8[] memory p) {
        p = new uint8[](3);
        (p[0], p[1], p[2]) = (a, b, c);
    }

    /// Four unrelated projects asking 100 each, pool 200, open.
    function simple() internal returns (SignedBallots round) {
        round = fresh();
        for (uint160 i; i < 4; ++i) {
            round.addInitiative(address(0x1000 + i), 100, false, 0);
        }
        round.setPoolUsd(200);
        vm.warp(round.opensAt());
    }

    function test_fixtures() public {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/../shared/vote/fixtures/ballot-rules.json"));
        uint256 n;
        while (vm.keyExistsJson(json, string.concat(".[", vm.toString(n), "]"))) ++n;
        assertGt(n, 40);
        for (uint256 k; k < n; ++k) {
            string memory c = string.concat(".[", vm.toString(k), "]");
            SignedBallots round = deployCase(json, c);
            (bytes memory ballot, uint8[] memory proof) = ballotOf(json, c);
            vm.prank(voter);
            (bool success,) = address(round).call(abi.encodeCall(round.vote, (1, 1, ballot, proof)));
            assertEq(
                success,
                vm.parseJsonBool(json, string.concat(c, ".ok")),
                vm.parseJsonString(json, string.concat(c, ".name"))
            );
        }
    }

    function deployCase(string memory json, string memory c) internal returns (SignedBallots round) {
        round = fresh();
        uint256 groups = vm.parseJsonUint(json, string.concat(c, ".sol.groupCount"));
        for (uint256 g; g < groups; ++g) {
            round.addGroup(bytes32(g + 1));
        }
        uint256[] memory asks = vm.parseJsonUintArray(json, string.concat(c, ".sol.asks"));
        bool[] memory rfp = vm.parseJsonBoolArray(json, string.concat(c, ".sol.rfp"));
        uint256[] memory masks = vm.parseJsonUintArray(json, string.concat(c, ".sol.masks"));
        for (uint256 i; i < asks.length; ++i) {
            round.addInitiative(address(uint160(0x1000 + i)), asks[i], rfp[i], masks[i]);
        }
        uint256 tiers = vm.parseJsonUint(json, string.concat(c, ".independentTiers"));
        if (tiers != 1) round.setIndependentTiers(uint8(tiers));
        round.setPoolUsd(vm.parseJsonUint(json, string.concat(c, ".sol.pool")));
        vm.warp(round.opensAt());
    }

    function ballotOf(string memory json, string memory c)
        internal
        pure
        returns (bytes memory ballot, uint8[] memory proof)
    {
        uint256[] memory ranks = vm.parseJsonUintArray(json, string.concat(c, ".ballot"));
        ballot = new bytes(ranks.length);
        for (uint256 i; i < ranks.length; ++i) {
            ballot[i] = bytes1(uint8(ranks[i]));
        }
        uint256[] memory p = vm.parseJsonUintArray(json, string.concat(c, ".proof"));
        proof = new uint8[](p.length);
        for (uint256 i; i < p.length; ++i) {
            proof[i] = uint8(p[i]);
        }
    }

    function test_shortBallotRecordsAfterAnAddition() public {
        SignedBallots round = simple();
        vm.prank(voter);
        round.vote(1, 1, hex"010101ff", proof3(0, 1, 2));
        // Between S's settlement span and A's first tally, a project may join.
        vm.warp(round.latestSettlementAt(0));
        round.addInitiative(address(0x2000), 100, false, 0);
        assertEq(round.projectCount(), 5);
        vm.prank(voter);
        round.vote(1, 2, hex"010101ff", proof3(0, 1, 2)); // signed before the addition
        vm.prank(voter);
        round.vote(1, 3, hex"01010101ff", proof3(0, 1, 2));
    }

    function test_addingClosedInsideQuietEnding() public {
        SignedBallots round = simple();
        vm.warp(round.firstTallyAt(0));
        vm.expectRevert(SignedBallots.AddingClosed.selector);
        round.addInitiative(address(0x2000), 100, false, 0);
        vm.expectRevert(SignedBallots.AddingClosed.selector);
        round.addGroup("Seal");
        vm.warp(round.latestSettlementAt(0) - 1);
        vm.expectRevert(SignedBallots.AddingClosed.selector);
        round.addInitiative(address(0x2000), 100, false, 0);
        vm.warp(round.latestSettlementAt(0));
        round.addInitiative(address(0x2000), 100, false, 0);
        vm.warp(round.hardDeadline());
        vm.expectRevert(SignedBallots.AddingClosed.selector);
        round.addInitiative(address(0x2001), 100, false, 0);
    }

    function test_addingOpenAfterOpeningBeforeS() public {
        SignedBallots round = simple();
        round.addGroup("Seal");
        round.addInitiative(address(0x2000), 100, false, 1);
        assertEq(round.initiative(4).groups, 1);
    }

    function test_rfpCannotHaveGroups() public {
        SignedBallots round = fresh();
        round.addGroup("Seal");
        vm.expectRevert(RoundAccounting.RfpWithGroups.selector);
        round.addInitiative(address(0x1000), 100, true, 1);
    }

    function test_unknownGroupReverts() public {
        SignedBallots round = fresh();
        round.addGroup("Seal");
        vm.expectRevert(RoundAccounting.UnknownGroup.selector);
        round.addInitiative(address(0x1000), 100, false, 2);
    }

    function test_badProofReverts() public {
        SignedBallots round = fresh();
        round.addGroup("Seal");
        round.addInitiative(address(0x1000), 100, false, 1);
        round.addInitiative(address(0x1001), 100, false, 1);
        round.addInitiative(address(0x1002), 100, false, 0);
        round.addInitiative(address(0x1003), 100, false, 0);
        vm.warp(round.opensAt());
        vm.startPrank(voter);
        vm.expectRevert(abi.encodeWithSelector(SignedBallots.BadProof.selector, uint8(0)));
        round.vote(1, 1, hex"01010101", proof3(0, 1, 2)); // 0 and 1 share Seal
        vm.expectRevert(abi.encodeWithSelector(SignedBallots.BadProof.selector, uint8(0)));
        round.vote(1, 1, hex"01010104", proof3(0, 2, 3)); // 3 is not in Tier-S
        round.vote(1, 1, hex"01010101", proof3(0, 2, 3));
        vm.stopPrank();
    }

    function test_tooManyTiers() public {
        SignedBallots round = simple();
        round = fresh();
        for (uint160 i; i < 6; ++i) {
            round.addInitiative(address(0x1000 + i), 100, false, 0);
        }
        vm.warp(round.opensAt());
        vm.prank(voter);
        vm.expectRevert(SignedBallots.TooManyTiers.selector);
        round.vote(1, 1, hex"010101040506", proof3(0, 1, 2));
    }

    function test_tooSmallAndOverHalf() public {
        SignedBallots round = fresh();
        round.addGroup("Seal");
        round.addInitiative(address(0x1000), 100, false, 1);
        round.addInitiative(address(0x1001), 100, false, 1);
        round.addInitiative(address(0x1002), 100, false, 0);
        round.addInitiative(address(0x1003), 50, true, 0);
        round.setPoolUsd(201);
        vm.warp(round.opensAt());
        vm.startPrank(voter);
        vm.expectRevert(SignedBallots.BallotTooSmall.selector);
        round.vote(1, 1, hex"01ff0101", proof3(0, 2, 3)); // 250 < 301.5
        vm.stopPrank();
        round = fresh();
        round.addGroup("Seal");
        round.addInitiative(address(0x1000), 100, false, 1);
        round.addInitiative(address(0x1001), 100, false, 1);
        round.addInitiative(address(0x1002), 100, false, 0);
        round.addInitiative(address(0x1003), 50, true, 0);
        vm.warp(round.opensAt());
        vm.prank(voter);
        vm.expectRevert(abi.encodeWithSelector(SignedBallots.GroupOverHalf.selector, uint8(0), uint8(0)));
        round.vote(1, 1, hex"01010101", proof3(0, 2, 3)); // Seal 200 of 350
    }

    function test_tooFewInTier() public {
        SignedBallots round = simple();
        vm.prank(voter);
        vm.expectRevert(abi.encodeWithSelector(SignedBallots.TooFewIndependent.selector, uint8(0)));
        round.vote(1, 1, hex"01010303", proof3(0, 1, 2));
    }

    function test_frozenAfterOpen() public {
        SignedBallots round = simple();
        vm.expectRevert(SignedBallots.ConfigurationFrozen.selector);
        round.setInitiative(0, address(0x1000), 1, false, 0);
        vm.expectRevert(SignedBallots.ConfigurationFrozen.selector);
        round.setIndependentTiers(3);
    }

    function test_tierSIsAlwaysChecked() public {
        SignedBallots round = fresh();
        vm.expectRevert(SignedBallots.InvalidTiers.selector);
        round.setIndependentTiers(2);
        vm.expectRevert(SignedBallots.InvalidTiers.selector);
        round.setIndependentTiers(7);
        round.setIndependentTiers(3);
        assertEq(round.independentTiers(), 3);
    }
}
