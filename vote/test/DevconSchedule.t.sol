// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {SignedBallots} from "../contracts/SignedBallots.sol";
import {RoundAccounting} from "../contracts/RoundAccounting.sol";

/// The Devcon 8 round as scripts/devcon-deploy.ts configures it: one 1-second
/// window so registration closes exactly at C (2026-11-06 18:30:00 UTC).
contract DevconScheduleTest is Test {
    uint64 constant C = 1793989800;
    address constant ADMIN = 0xf632Ce27Ea72deA30d30C1A9700B6b3bCeAA05cF;
    uint256 constant POOL = 913_244e6;

    SignedBallots round;
    address relayer = makeAddr("relayer");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    uint64 opensAt;

    function setUp() public {
        vm.warp(1793800000); // 3 Nov 2026
        opensAt = uint64(block.timestamp + 15 minutes);
        uint64[3] memory tally = [C - 1, C, C + 1];
        vm.startPrank(relayer);
        round = new SignedBallots(relayer, address(0), "TheDAO Devcon 8", "DEVCON", SignedBallots.Schedule(opensAt, 1, tally, 1));
        round.addInitiative(makeAddr("i0"), 10_000e6);
        round.addInitiative(makeAddr("i1"), 20_000e6);
        round.setPoolUsd(POOL);
        bytes32[3] memory handed = [round.DEFAULT_ADMIN_ROLE(), round.ADMIN_ROLE(), round.PLEDGE_ROLE()];
        for (uint256 i; i < 3; ++i) round.grantRole(handed[i], ADMIN);
        for (uint256 i; i < 3; ++i) round.renounceRole(handed[i], relayer);
        round.renounceRole(round.BLOB_SUBMITTER_ROLE(), relayer);
        vm.stopPrank();
    }

    function test_deadlinesLandOnTheClose() public view {
        assertEq(round.registrationDeadline(), C);
        assertEq(round.hardDeadline(), C + 2);
        assertEq(round.poolUsd(), POOL);
        assertTrue(round.poolInitialized());
    }

    function test_mintOpenUntilTheClose() public {
        vm.warp(C - 1);
        vm.prank(relayer);
        round.mint(alice, 1);
        assertEq(round.ownerOf(1), alice);
        vm.warp(C);
        vm.prank(relayer);
        vm.expectRevert(SignedBallots.RegistrationClosed.selector);
        round.mint(bob, 2);
    }

    function test_codeNumberMintsOnce() public {
        vm.warp(opensAt);
        vm.startPrank(relayer);
        round.mint(alice, 7);
        vm.expectRevert();
        round.mint(bob, 7);
        vm.stopPrank();
    }

    function test_firstBallotClosesAtC() public {
        vm.warp(opensAt);
        vm.prank(relayer);
        round.mint(alice, 1);
        vm.warp(C);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SignedBallots.NotRegistered.selector, 1));
        round.vote(1, 1, hex"01ff");
    }

    /// The contract still takes revisions for two seconds after C; the app and the
    /// tally ignore anything mined at or after C.
    function test_revisionWindowAfterCloseIsTwoSeconds() public {
        vm.warp(opensAt);
        vm.prank(relayer);
        round.mint(alice, 1);
        vm.prank(alice);
        round.vote(1, 1, hex"01ff");
        vm.warp(C + 1);
        vm.prank(alice);
        round.vote(1, 2, hex"ff01");
        vm.warp(C + 2);
        vm.prank(alice);
        vm.expectRevert(SignedBallots.VotingClosed.selector);
        round.vote(1, 3, hex"0101");
    }

    function test_relayerKeepsOnlyMinting() public {
        assertTrue(round.hasRole(round.MINTER_ROLE(), relayer));
        assertFalse(round.hasRole(round.ADMIN_ROLE(), relayer));
        assertFalse(round.hasRole(round.DEFAULT_ADMIN_ROLE(), relayer));
        assertFalse(round.hasRole(round.PLEDGE_ROLE(), relayer));
        assertFalse(round.hasRole(round.BLOB_SUBMITTER_ROLE(), relayer));
        assertTrue(round.hasRole(round.DEFAULT_ADMIN_ROLE(), ADMIN));
        assertTrue(round.hasRole(round.ADMIN_ROLE(), ADMIN));
        vm.startPrank(relayer);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, relayer, round.ADMIN_ROLE())
        );
        round.setPoolUsd(POOL + 1);
        vm.stopPrank();
    }

    function test_initiativesFreezeAtOpening() public {
        vm.warp(opensAt);
        vm.prank(ADMIN);
        vm.expectRevert(SignedBallots.ConfigurationFrozen.selector);
        round.addInitiative(makeAddr("late"), 1e6);
    }
}
