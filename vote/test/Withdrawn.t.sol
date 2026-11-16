// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {SignedBallots} from "../contracts/SignedBallots.sol";
import {RoundAccounting} from "../contracts/RoundAccounting.sol";

/// @notice Withdrawn initiatives (docs/superpowers/specs/2026-11-15-withdrawn-initiatives-design.md):
///         an admin flag, open until the hard deadline, that makes a project ask $0 for the
///         size rule only. The independence and affiliation rules and the rank structure ignore it.
contract WithdrawnTest is Test {
    address internal voter = vm.addr(1000);
    address internal stranger = address(0xBAD);

    event InitiativeWithdrawn(uint256 indexed initiativeId, bool withdrawn);

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

    /// Projects with the given goals and group masks (`groups` groups registered), the pool
    /// set, still before opening.
    function setup(uint256[] memory goals, uint256[] memory masks, uint256 groups, uint256 pool)
        internal
        returns (SignedBallots round)
    {
        round = fresh();
        for (uint256 g; g < groups; ++g) {
            round.addGroup(bytes32(g + 1));
        }
        for (uint256 i; i < goals.length; ++i) {
            round.addInitiative(address(uint160(0x1000 + i)), goals[i], false, masks[i]);
        }
        round.setPoolUsd(pool);
    }

    /// Like `setup`, voting open.
    function opened(uint256[] memory goals, uint256[] memory masks, uint256 groups, uint256 pool)
        internal
        returns (SignedBallots round)
    {
        round = setup(goals, masks, groups, pool);
        vm.warp(round.opensAt());
    }

    function list(uint256 a, uint256 b, uint256 c, uint256 d) internal pure returns (uint256[] memory x) {
        x = new uint256[](4);
        (x[0], x[1], x[2], x[3]) = (a, b, c, d);
    }

    function list(uint256 a, uint256 b, uint256 c, uint256 d, uint256 e) internal pure returns (uint256[] memory x) {
        x = new uint256[](5);
        (x[0], x[1], x[2], x[3], x[4]) = (a, b, c, d, e);
    }

    function none(uint256 n) internal pure returns (uint256[] memory) {
        return new uint256[](n);
    }

    /// Four unrelated projects asking 100 each, pool 200, voting open.
    function simple() internal returns (SignedBallots) {
        return opened(list(100, 100, 100, 100), none(4), 0, 200);
    }

    function test_adminWithdrawsAndUndoes() public {
        SignedBallots round = simple();
        assertEq(round.withdrawnMask(), 0);
        vm.expectEmit(true, false, false, true, address(round));
        emit InitiativeWithdrawn(1, true);
        round.withdrawInitiative(1);
        assertTrue(round.initiative(1).withdrawn);
        assertFalse(round.initiative(0).withdrawn);
        assertEq(round.withdrawnMask(), 2);
        vm.expectEmit(true, false, false, true, address(round));
        emit InitiativeWithdrawn(1, false);
        round.undoWithdrawInitiative(1);
        assertFalse(round.initiative(1).withdrawn);
        assertEq(round.withdrawnMask(), 0);
    }

    function test_maskHasOneBitPerProject() public {
        SignedBallots round = simple();
        round.withdrawInitiative(0);
        round.withdrawInitiative(3);
        assertEq(round.withdrawnMask(), 9);
    }

    function test_onlyAdmin() public {
        SignedBallots round = simple();
        bytes memory unauthorized = abi.encodeWithSelector(
            IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, round.ADMIN_ROLE()
        );
        vm.prank(stranger);
        vm.expectRevert(unauthorized);
        round.withdrawInitiative(1);
        round.withdrawInitiative(1);
        vm.prank(stranger);
        vm.expectRevert(unauthorized);
        round.undoWithdrawInitiative(1);
    }

    function test_unknownInitiativeReverts() public {
        SignedBallots round = simple();
        vm.expectRevert(RoundAccounting.UnknownInitiative.selector);
        round.withdrawInitiative(4);
        vm.expectRevert(RoundAccounting.UnknownInitiative.selector);
        round.undoWithdrawInitiative(4);
    }

    function test_revertsWhenAlreadyInState() public {
        SignedBallots round = simple();
        vm.expectRevert(RoundAccounting.NotWithdrawn.selector);
        round.undoWithdrawInitiative(1);
        round.withdrawInitiative(1);
        vm.expectRevert(RoundAccounting.AlreadyWithdrawn.selector);
        round.withdrawInitiative(1);
    }

    function test_openInsideQuietEnding() public {
        SignedBallots round = simple();
        vm.warp(round.firstTallyAt(0) + 1);
        vm.expectRevert(SignedBallots.AddingClosed.selector);
        round.addInitiative(address(0x2000), 100, false, 0);
        round.withdrawInitiative(1);
        assertTrue(round.initiative(1).withdrawn);
        round.undoWithdrawInitiative(1);
        assertFalse(round.initiative(1).withdrawn);
    }

    function test_closedAtHardDeadline() public {
        SignedBallots round = simple();
        round.withdrawInitiative(1);
        vm.warp(round.hardDeadline() - 1);
        round.withdrawInitiative(2);
        vm.warp(round.hardDeadline());
        vm.expectRevert(SignedBallots.VotingClosed.selector);
        round.withdrawInitiative(0);
        vm.expectRevert(SignedBallots.VotingClosed.selector);
        round.undoWithdrawInitiative(1);
    }

    function test_addInitiativeStartsLive() public {
        SignedBallots round = simple();
        round.withdrawInitiative(0);
        round.addInitiative(address(0x2000), 100, false, 0);
        assertFalse(round.initiative(4).withdrawn);
        assertEq(round.withdrawnMask(), 1);
    }

    function test_setInitiativeKeepsFlag() public {
        SignedBallots round = setup(list(100, 100, 100, 100), none(4), 0, 200);
        round.withdrawInitiative(1);
        round.setInitiative(1, address(0x3001), 250, false, 0);
        round.setInitiative(2, address(0x3002), 250, false, 0);
        assertTrue(round.initiative(1).withdrawn);
        assertEq(round.initiative(1).goalUsd, 250);
        assertEq(round.initiative(1).account, address(0x3001));
        assertFalse(round.initiative(2).withdrawn);
        assertEq(round.withdrawnMask(), 2);
    }

    function test_setGroupsKeepsFlag() public {
        SignedBallots round = opened(list(100, 100, 100, 100), none(4), 1, 200);
        round.withdrawInitiative(1);
        round.setInitiativeGroups(1, 1);
        round.setInitiativeGroups(2, 1);
        assertTrue(round.initiative(1).withdrawn);
        assertEq(round.initiative(1).groups, 1);
        assertFalse(round.initiative(2).withdrawn);
    }

    function test_initiativeUsdUnchanged() public {
        SignedBallots round = simple();
        round.setPledge(bytes32(uint256(1)), 1, 0, 30);
        round.withdrawInitiative(1);
        (,, uint256 totalUsd, uint256 askUsd) = round.initiativeUsd(1);
        assertEq(totalUsd, 30);
        assertEq(askUsd, 70);
    }

    function test_withdrawnAsksNothingForSize() public {
        // Pool $100k: a ballot needs $150k unless it leaves out nothing that still asks.
        // A, B, C ask $120k; X asks $40k; D ($50k) is left out.
        SignedBallots round = opened(list(60_000e6, 30_000e6, 30_000e6, 40_000e6, 50_000e6), none(5), 0, 100_000e6);
        vm.prank(voter);
        round.vote(1, 1, hex"01010101ff", proof3(0, 1, 2)); // $160k with X live
        round.withdrawInitiative(3);
        vm.prank(voter);
        vm.expectRevert(SignedBallots.BallotTooSmall.selector);
        round.vote(1, 2, hex"01010101ff", proof3(0, 1, 2)); // $120k: X adds $0
    }

    function test_withdrawnStillIndependent() public {
        // X (0), Y (1), Z (2) pairwise unrelated in S-Tier; X withdrawn still counts as one
        // of the three independent projects.
        SignedBallots round = opened(list(100, 100, 100, 100), none(4), 0, 0);
        round.withdrawInitiative(0);
        vm.prank(voter);
        round.vote(1, 1, hex"010101ff", proof3(0, 1, 2));
        assertEq(round.nonceOf(1), 1);
    }

    function test_withdrawnKeepsRealAskInGroups() public {
        // S-Tier = {X in g $100k, Y in h $50k, P in k $60k}: g holds 100 of 210, not over half.
        // Were P's ask $0, g would hold 100 of 150.
        SignedBallots round = opened(list(100_000e6, 50_000e6, 60_000e6, 10_000e6), list(1, 2, 4, 0), 3, 0);
        round.withdrawInitiative(2);
        vm.prank(voter);
        round.vote(1, 1, hex"010101ff", proof3(0, 1, 2));
        assertEq(round.nonceOf(1), 1);
    }

    function test_withdrawnLeftOutIsFine() public {
        // Pool $100k: the live projects ask $100k in all, below $150k. Leaving out X (asks
        // $40k) blocks the ballot until X is withdrawn.
        SignedBallots round = opened(list(50_000e6, 30_000e6, 20_000e6, 40_000e6), none(4), 0, 100_000e6);
        vm.prank(voter);
        vm.expectRevert(SignedBallots.BallotTooSmall.selector);
        round.vote(1, 1, hex"010101ff", proof3(0, 1, 2));
        round.withdrawInitiative(3);
        vm.prank(voter);
        round.vote(1, 1, hex"010101ff", proof3(0, 1, 2));
        assertEq(round.nonceOf(1), 1);
    }

    function test_withdrawnKeepsShape() public {
        // X (rank 1) withdrawn still holds its place: four projects share rank 1, so the
        // next tier starts at rank 5, not 4.
        SignedBallots round = opened(list(100, 100, 100, 100, 100), none(5), 0, 0);
        round.withdrawInitiative(0);
        vm.prank(voter);
        round.vote(1, 1, hex"0101010105", proof3(1, 2, 3));
        assertEq(round.nonceOf(1), 1);
        vm.prank(voter);
        vm.expectRevert(SignedBallots.InvalidBallot.selector);
        round.vote(1, 2, hex"0101010104", proof3(1, 2, 3));
    }

    function test_earlierBallotStaysRecorded() public {
        SignedBallots round = simple();
        bytes memory ballot = hex"01010101";
        vm.prank(voter);
        round.vote(1, 1, ballot, proof3(0, 1, 2));
        bytes32 transcript = round.transcript();
        round.withdrawInitiative(3);
        assertEq(round.ballotHashOf(1), keccak256(ballot));
        assertTrue(round.hasRegistrationReceipt(1));
        assertEq(round.nonceOf(1), 1);
        assertEq(round.transcript(), transcript);
        vm.prank(voter);
        round.vote(1, 2, ballot, proof3(0, 1, 2));
        assertEq(round.nonceOf(1), 2);
    }
}
