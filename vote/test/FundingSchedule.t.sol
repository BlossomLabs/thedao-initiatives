// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Fixture} from "./helpers/Fixtures.sol";
import {SignedBallots} from "../contracts/SignedBallots.sol";

contract FundingScheduleTest is Fixture {
    SignedBallots internal round;

    function setUp() public override {
        super.setUp();
        round = new SignedBallots(address(this), address(0), "Funding test", "FUND", schedule());
        round.addInitiative(INITIATIVE_A, 1_000e6);
        round.mint(alice, 1);
    }

    function dates() internal view returns (uint64[3] memory result) {
        for (uint256 i; i < 3; ++i) {
            result[i] = round.firstTallyAt(i);
        }
    }

    function test_initialFundingBeforeSDoesNotChangeDates() public {
        uint64[3] memory original = dates();
        uint64 registrationEnd = round.registrationDeadline();
        uint64 hardEnd = round.hardDeadline();
        vm.warp(original[0] - 1);
        round.setPoolUsd(1_000e6);
        assertTrue(round.poolInitialized());
        for (uint256 i; i < 3; ++i) {
            assertEq(round.firstTallyAt(i), original[i]);
        }
        assertEq(round.registrationDeadline(), registrationEnd);
        assertEq(round.hardDeadline(), hardEnd);
    }

    function test_initialFundingAtOrAfterSRejectsWithoutChangingStateOrDates() public {
        uint64[3] memory original = dates();
        vm.warp(original[0]);
        vm.expectRevert(SignedBallots.InitialFundingTooLate.selector);
        round.setPoolUsd(1_000e6);
        vm.expectRevert(SignedBallots.InitialFundingTooLate.selector);
        round.setPoolUsd(0);
        vm.warp(uint256(round.hardDeadline()) + 1 days);
        vm.expectRevert(SignedBallots.InitialFundingTooLate.selector);
        round.setPoolUsd(1_000e6);
        assertFalse(round.poolInitialized());
        assertEq(round.poolUsd(), 0);
        for (uint256 i; i < 3; ++i) {
            assertEq(round.firstTallyAt(i), original[i]);
        }
    }

    function test_unfundedSCanBePostponedWithoutMovingAOrB() public {
        uint64[3] memory next = dates();
        uint64 oldS = next[0];
        uint64 oldEnd = round.hardDeadline();
        vm.warp(oldS);
        vm.prank(alice);
        round.vote(1, 1, hex"01");
        next[0] += 1 hours;
        round.setDates(round.opensAt(), next);
        assertEq(round.firstTallyAt(0), oldS + 1 hours);
        assertEq(round.firstTallyAt(1), next[1]);
        assertEq(round.firstTallyAt(2), next[2]);
        assertEq(round.registrationDeadline(), next[0] + round.initialWindow());
        assertEq(round.hardDeadline(), oldEnd);
        round.setPoolUsd(1_000e6);
        assertEq(round.firstTallyAt(0), next[0]);
        assertEq(round.nonceOf(1), 1);
    }

    function test_missingFundingWaitsForExplicitFutureDates() public {
        vm.warp(uint256(round.hardDeadline()) + 1 days);
        round.mint(bob, 2);
        vm.prank(alice);
        round.vote(1, 1, hex"01");
        round.setPledge(keccak256("waiting"), 0, round.USD(), 100e6);
        uint64[3] memory next;
        next[0] = uint64(block.timestamp + 1 days);
        next[1] = next[0] + 3 days;
        next[2] = next[1] + 4 days;
        round.setDates(round.opensAt(), next);
        round.setPoolUsd(1_000e6);
        for (uint256 i; i < 3; ++i) {
            assertEq(round.firstTallyAt(i), next[i]);
        }
        assertEq(round.registrationReceiptCount(), 1);
        assertEq(round.pledgedAmount(0, round.USD()), 100e6);
        vm.warp(round.registrationDeadline());
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(SignedBallots.NotRegistered.selector, 2));
        round.vote(2, 1, hex"01");
    }

    function test_futureTierCanMoveIndependentlyAfterSStarts() public {
        round.setPoolUsd(1_000e6);
        uint64[3] memory next = dates();
        uint64 registrationEnd = round.registrationDeadline();
        uint64 hardEnd = round.hardDeadline();
        vm.warp(uint256(next[0]) + 1 hours);
        next[1] += 1 hours;
        vm.expectEmit(false, false, false, true, address(round));
        emit SignedBallots.ScheduleConfigured(
            round.opensAt(), round.initialWindow(), next, round.maxWindows(), registrationEnd, hardEnd
        );
        round.setDates(round.opensAt(), next);
        for (uint256 i; i < 3; ++i) {
            assertEq(round.firstTallyAt(i), next[i]);
        }
        assertEq(round.registrationDeadline(), registrationEnd);
        assertEq(round.hardDeadline(), hardEnd);
        round.setPoolUsd(2_000e6);
        assertEq(round.firstTallyAt(1), next[1]);
    }

    function test_startedDatesAndClosedRegistrationCannotBeReopened() public {
        uint64 opening = round.opensAt();
        round.setPoolUsd(1_000e6);
        uint64[3] memory next = dates();
        vm.warp(round.registrationDeadline());
        next[0] += 1 hours;
        vm.expectRevert(SignedBallots.DateAlreadyStarted.selector);
        round.setDates(opening, next);
        next = dates();
        vm.expectRevert(SignedBallots.DateAlreadyStarted.selector);
        round.setDates(opening + 1, next);
        vm.warp(next[1]);
        next[1] += 1 hours;
        vm.expectRevert(SignedBallots.DateAlreadyStarted.selector);
        round.setDates(opening, next);
        next = dates();
        vm.warp(next[2]);
        next[2] += 1 hours;
        vm.expectRevert(SignedBallots.DateAlreadyStarted.selector);
        round.setDates(opening, next);
    }

    function test_openingCanChangeOnlyBeforeItStarts() public {
        uint64[3] memory next = dates();
        uint64 newOpening = round.opensAt() + 1 hours;
        round.setDates(newOpening, next);
        assertEq(round.opensAt(), newOpening);
        vm.prank(alice);
        vm.expectRevert(SignedBallots.VotingNotStarted.selector);
        round.vote(1, 1, hex"01");
        vm.warp(newOpening);
        vm.prank(alice);
        round.vote(1, 1, hex"01");
        vm.expectRevert(SignedBallots.DateAlreadyStarted.selector);
        round.setDates(newOpening + 1 hours, next);
    }

    function test_constructorAndUpdatesRejectOverlapsAndOverflow() public {
        uint64 opening = round.opensAt();
        SignedBallots.Schedule memory s = schedule();
        s.firstTallyAt[1] = s.firstTallyAt[0] + round.maximumTierDuration() - 1;
        vm.expectRevert(SignedBallots.InvalidSchedule.selector);
        new SignedBallots(address(this), address(0), "Bad", "BAD", s);
        uint64[3] memory next = s.firstTallyAt;
        vm.expectRevert(SignedBallots.InvalidSchedule.selector);
        round.setDates(opening, next);
        next = dates();
        next[2] = next[1] + round.maximumTierDuration() - 1;
        vm.expectRevert(SignedBallots.InvalidSchedule.selector);
        round.setDates(opening, next);
        next = dates();
        next[0] = opening - 1;
        vm.expectRevert(SignedBallots.InvalidSchedule.selector);
        round.setDates(opening, next);
        next = dates();
        next[2] = type(uint64).max;
        vm.expectRevert(SignedBallots.InvalidSchedule.selector);
        round.setDates(opening, next);
    }

    function test_singleWindowRegistrationCannotOverlapAAtDeploymentOrUpdate() public {
        SignedBallots.Schedule memory s = schedule();
        s.maxWindows = 1;
        s.firstTallyAt[1] = s.firstTallyAt[0] + s.initialWindow - 1;
        vm.expectRevert(SignedBallots.InvalidSchedule.selector);
        new SignedBallots(address(this), address(0), "Bad", "BAD", s);
        s.firstTallyAt[1] += 1;
        s.firstTallyAt[2] = s.firstTallyAt[1] + s.initialWindow;
        SignedBallots edge = new SignedBallots(address(this), address(0), "Edge", "EDGE", s);
        assertEq(edge.registrationDeadline(), s.firstTallyAt[1]);
        s.firstTallyAt[1] -= 1;
        vm.expectRevert(SignedBallots.InvalidSchedule.selector);
        edge.setDates(s.opensAt, s.firstTallyAt);
    }

    function test_datesCannotMoveIntoThePastAndRequireAdmin() public {
        uint64 opening = round.opensAt();
        uint64[3] memory next = dates();
        vm.prank(bob);
        vm.expectRevert();
        round.setDates(opening, next);
        next[0] = uint64(block.timestamp);
        vm.expectRevert(SignedBallots.InvalidSchedule.selector);
        round.setDates(opening, next);
        next = dates();
        vm.expectRevert(SignedBallots.InvalidSchedule.selector);
        round.setDates(uint64(block.timestamp), next);
    }

    function testFuzz_nonoverlappingDatesAreStoredExactly(uint32 delay, uint32 gapA, uint32 gapB) public {
        uint64[3] memory next;
        next[0] = round.firstTallyAt(0) + uint64(delay);
        next[1] = next[0] + round.maximumTierDuration() + uint64(gapA);
        next[2] = next[1] + round.maximumTierDuration() + uint64(gapB);
        round.setDates(round.opensAt(), next);
        for (uint256 i; i < 3; ++i) {
            assertEq(round.firstTallyAt(i), next[i]);
        }
        assertEq(round.registrationDeadline(), next[0] + round.initialWindow());
        assertLe(round.registrationDeadline(), next[1]);
        assertLe(round.latestSettlementAt(0), next[1]);
        assertLe(round.latestSettlementAt(1), next[2]);
        assertEq(round.latestSettlementAt(2), round.hardDeadline());
    }
}
