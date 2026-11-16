// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Fixture, MockFeed, MockToken} from "./helpers/Fixtures.sol";
import {SignedBallots} from "../contracts/SignedBallots.sol";
import {RoundAccounting} from "../contracts/RoundAccounting.sol";

contract CorrectionsTest is Fixture {
    function test_initiativeCorrectionKeepsIdentityWithdrawalAndBallotHistory() public {
        vm.warp(start);
        vm.prank(alice);
        ballots.vote(1, 1, ranks, proofOf(ranks));
        bytes32 hash = ballots.ballotHashOf(1);
        bytes32 transcript = ballots.transcript();
        ballots.withdrawInitiative(0);
        uint256 revision = ballots.configRevision();
        ballots.setInitiative(0, address(0xBEEF), 9_000e6, true, 0);
        assertEq(ballots.initiativeCount(), 4);
        assertEq(ballots.initiative(0).account, address(0xBEEF));
        assertTrue(ballots.initiative(0).withdrawn);
        assertEq(ballots.ballotHashOf(1), hash);
        assertEq(ballots.transcript(), transcript);
        assertEq(ballots.configRevision(), revision + 1);
        vm.expectRevert(RoundAccounting.ConfigurationChangedSinceReview.selector);
        ballots.requireConfigRevision(revision);
        ballots.requireConfigRevision(revision + 1);
    }

    function test_correctionGateIncludesEveryScheduledWindowAndExcludesCutoff() public {
        vm.warp(ballots.firstTallyAt(0));
        vm.expectRevert(SignedBallots.AddingClosed.selector);
        ballots.setInitiative(0, INITIATIVE_A, 1, false, 0);
        vm.warp(ballots.latestSettlementAt(0) - 1);
        vm.expectRevert(SignedBallots.AddingClosed.selector);
        ballots.setInitiative(0, INITIATIVE_A, 1, false, 0);
        vm.warp(ballots.latestSettlementAt(0));
        ballots.setInitiative(0, INITIATIVE_A, 1, false, 0);
        vm.warp(ballots.hardDeadline());
        vm.expectRevert(SignedBallots.AddingClosed.selector);
        ballots.setInitiative(0, INITIATIVE_A, 2, false, 0);
    }

    function test_walletCorrectionCountsReplacementBalanceWithoutMovingFunds() public {
        MockToken token = new MockToken(6);
        ballots.registerCurrency(address(token), address(0));
        token.mint(INITIATIVE_A, 100e6);
        token.mint(address(0xBEEF), 200e6);
        (uint256 donated,,,) = ballots.initiativeUsd(0);
        assertEq(donated, 100e6);
        vm.warp(start);
        ballots.setInitiative(0, address(0xBEEF), 20_000e6, false, 0);
        (donated,,,) = ballots.initiativeUsd(0);
        assertEq(donated, 200e6);
        assertEq(token.balanceOf(INITIATIVE_A), 100e6);
    }

    function test_feedCorrectionReseedsEvenWithOlderTimestampAndDifferentDecimals() public {
        MockToken token = new MockToken(6);
        MockFeed oldFeed = new MockFeed(8, 2e8);
        uint256 id = ballots.registerCurrency(address(token), address(oldFeed));
        MockFeed next = new MockFeed(6, 3e6);
        next.set(3e6, block.timestamp - 1);
        ballots.setCurrency(id, address(next), false);
        next.setUnavailable(true);
        assertEq(ballots.quoteUsd(id, 1e6), 3e6);
        ballots.setCurrency(id, address(0), false);
        assertEq(ballots.quoteUsd(id, 1e6), 1e6);
        (uint192 price,) = ballots.lastPrice(id);
        assertEq(price, 0);
    }

    function test_disabledCurrencyKeepsQuantitiesButCountsNoSupportAndCanBeRestored() public {
        MockToken token = new MockToken(6);
        uint256 id = ballots.registerCurrency(address(token), address(0));
        token.mint(INITIATIVE_A, 100e6);
        ballots.setPledge(bytes32("pledge"), 0, id, 50e6);
        ballots.setCurrency(id, address(0), true);
        (uint256 donated, uint256 pledged,,) = ballots.initiativeUsd(0);
        assertEq(donated + pledged, 0);
        assertEq(ballots.quoteUsd(id, 100e6), 0);
        (donated, pledged) = ballots.initiativeCurrencyAmounts(0, id);
        assertEq(donated + pledged, 150e6);
        vm.expectRevert(RoundAccounting.InvalidCurrency.selector);
        ballots.setPledge(bytes32("new"), 0, id, 1);
        ballots.setCurrency(id, address(0), false);
        (donated, pledged,,) = ballots.initiativeUsd(0);
        assertEq(donated + pledged, 150e6);
        vm.warp(start);
        vm.expectRevert(SignedBallots.ConfigurationFrozen.selector);
        ballots.setCurrency(id, address(0), true);
    }

    function test_scheduleCorrectionRecalculatesEveryDeadlineAtomically() public {
        SignedBallots.Schedule memory s = schedule();
        s.initialWindow = 12 hours;
        s.maxWindows = 3;
        ballots.setSchedule(s);
        assertEq(ballots.maximumTierDuration(), 21 hours);
        assertEq(ballots.mintDeadline(), s.firstTallyAt[0] + 12 hours);
        assertEq(ballots.registrationDeadline(), s.firstTallyAt[0] + 21 hours);
        assertEq(ballots.hardDeadline(), s.firstTallyAt[2] + 21 hours);
        vm.warp(s.opensAt);
        vm.expectRevert(SignedBallots.ConfigurationFrozen.selector);
        ballots.setSchedule(s);
    }

    function test_labelsEditableAfterCloseWithoutChangingAffiliations() public {
        uint8 group = ballots.addGroup("old");
        ballots.setInitiativeGroups(0, 1);
        vm.warp(ballots.hardDeadline());
        ballots.setGroupName(group, "corrected");
        ballots.setBaseURI("ipfs://corrected/");
        assertEq(ballots.groupName(group), bytes32("corrected"));
        assertEq(ballots.initiative(0).groups, 1);
        assertEq(ballots.tokenURI(1), "ipfs://corrected/1");
    }

    function test_poolProposalIsReplaceableAndNeedsSeparateBlockAndExactNonce() public {
        uint256 revision = ballots.configRevision();
        ballots.setPoolUsd(100e6);
        vm.expectRevert(RoundAccounting.ConfigurationChangedSinceReview.selector);
        ballots.requireConfigRevision(revision);
        vm.warp(ballots.firstTallyAt(0));
        vm.expectRevert(RoundAccounting.PoolUpdatePending.selector);
        ballots.setPoolUsd(1_000e6);
        ballots.proposePoolUsd(1_000e6);
        assertEq(ballots.poolUsd(), 100e6);
        uint256 first = ballots.poolUpdateNonce();
        revision = ballots.configRevision();
        ballots.proposePoolUsd(200e6);
        vm.expectRevert(RoundAccounting.ConfigurationChangedSinceReview.selector);
        ballots.requireConfigRevision(revision);
        vm.roll(vm.getBlockNumber() + 1);
        vm.expectRevert(RoundAccounting.StalePoolUpdate.selector);
        ballots.activatePoolUpdate(first);
        ballots.activatePoolUpdate(first + 1);
        assertEq(ballots.poolUsd(), 200e6);
        assertFalse(ballots.hasPendingPool());
        ballots.proposePoolUsd(300e6);
        uint256 nonce = ballots.poolUpdateNonce();
        vm.expectRevert(RoundAccounting.PoolUpdateNotReady.selector);
        ballots.activatePoolUpdate(nonce);
        revision = ballots.configRevision();
        ballots.cancelPoolUpdate(nonce);
        vm.expectRevert(RoundAccounting.ConfigurationChangedSinceReview.selector);
        ballots.requireConfigRevision(revision);
        assertEq(ballots.poolUsd(), 200e6);
    }

    function test_activationRechecksDeadlineAndReductionAfterFirstTally() public {
        ballots.setPoolUsd(100e6);
        ballots.proposePoolUsd(50e6);
        vm.roll(vm.getBlockNumber() + 1);
        vm.warp(ballots.firstTallyAt(0));
        uint256 nonce = ballots.poolUpdateNonce();
        vm.expectRevert(RoundAccounting.PoolCannotDecrease.selector);
        ballots.activatePoolUpdate(nonce);
        ballots.proposePoolUsd(150e6);
        nonce = ballots.poolUpdateNonce();
        vm.roll(vm.getBlockNumber() + 1);
        vm.warp(ballots.hardDeadline());
        vm.expectRevert(SignedBallots.VotingClosed.selector);
        ballots.activatePoolUpdate(nonce);
        ballots.cancelPoolUpdate(nonce);
        assertEq(ballots.poolUsd(), 100e6);
    }

    function test_correctionSettersRequireAdmin() public {
        uint8 group = ballots.addGroup("old");
        MockToken token = new MockToken(6);
        uint256 currency = ballots.registerCurrency(address(token), address(0));
        SignedBallots.Schedule memory s = schedule();
        vm.startPrank(alice);
        vm.expectRevert();
        ballots.setInitiative(0, alice, 1, false, 0);
        vm.expectRevert();
        ballots.setGroupName(group, "new");
        vm.expectRevert();
        ballots.setCurrency(currency, address(0), true);
        vm.expectRevert();
        ballots.setSchedule(s);
        vm.expectRevert();
        ballots.setBaseURI("ipfs://bad/");
        vm.expectRevert();
        ballots.proposePoolUsd(1);
        vm.expectRevert();
        ballots.cancelPoolUpdate(1);
        vm.expectRevert();
        ballots.activatePoolUpdate(1);
        vm.stopPrank();
    }
}
