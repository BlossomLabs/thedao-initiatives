// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Fixture, MockToken, MockFeed} from "./helpers/Fixtures.sol";

contract SettledAffiliationsTest is Fixture {
    MockToken private usd;
    bytes private initial = hex"0101010405";
    bytes private revision = hex"0101010504";

    function setUp() public override {
        super.setUp();
        usd = new MockToken(6);
        ballots.registerCurrency(address(usd), address(0));
        ballots.addGroup(bytes32("Affiliation"));
        ballots.setInitiative(0, INITIATIVE_A, 100_000e6, false, 1);
        ballots.setInitiative(1, INITIATIVE_B, 50_000e6, false, 0);
        ballots.setInitiative(2, INITIATIVE_C, 50_000e6, false, 0);
        ballots.setInitiative(3, INITIATIVE_D, 100_000e6, false, 0);
        ballots.addInitiative(address(0xA05), 100_000e6, false, 0);
        ballots.setPoolUsd(300_000e6);
    }

    function recordAndWait() private {
        vm.warp(start);
        vm.prank(alice);
        ballots.vote(1, 1, initial, proofOf(initial));
        vm.warp(ballots.firstTallyAt(0) + ballots.initialWindow() + 1);
    }

    function revise() private {
        vm.prank(alice);
        ballots.vote(1, 2, revision, proofOf(revision));
        assertEq(ballots.nonceOf(1), 2);
        assertEq(ballots.ballotHashOf(1), keccak256(revision));
    }

    function test_donationDoesNotStrandAnUnchangedSettledPrefix() public {
        recordAndWait();
        address donor = address(0xD010);
        usd.mint(donor, 1e6);
        vm.prank(donor);
        usd.transfer(INITIATIVE_B, 1e6);
        (,,, uint256 ask) = ballots.initiativeUsd(1);
        assertEq(ask, 49_999e6);
        revise();
    }

    function test_pledgeDoesNotStrandAnUnchangedSettledPrefix() public {
        recordAndWait();
        ballots.setPledge(bytes32(uint256(1)), 1, 1, 1e6);
        (,,, uint256 ask) = ballots.initiativeUsd(1);
        assertEq(ask, 49_999e6);
        revise();
    }

    function test_priceChangeDoesNotStrandAnUnchangedSettledPrefix() public {
        MockToken asset = new MockToken(6);
        MockFeed feed = new MockFeed(8, 1e8);
        ballots.registerCurrency(address(asset), address(feed));
        asset.mint(INITIATIVE_B, 1e6);
        recordAndWait();
        feed.set(2e8, block.timestamp);
        (,,, uint256 ask) = ballots.initiativeUsd(1);
        assertEq(ask, 49_998e6);
        revise();
    }

    function test_donationAfterSecondSettlementLeavesLaterChoicesEditable() public {
        ballots.setIndependentTiers(3);
        ballots.setInitiative(4, address(0xA05), 50_000e6, false, 0);
        ballots.addInitiative(address(0xA06), 50_000e6, false, 0);
        ballots.addInitiative(address(0xA07), 100_000e6, false, 0);
        ballots.addInitiative(address(0xA08), 100_000e6, false, 0);
        ballots.setInitiativeGroups(3, 1);
        uint8[] memory proof = new uint8[](6);
        for (uint8 i; i < 6; ++i) {
            proof[i] = i;
        }
        vm.warp(start);
        vm.prank(alice);
        ballots.vote(1, 1, hex"01010104040407ff", proof);
        vm.warp(ballots.firstTallyAt(1) + ballots.initialWindow() + 1);
        usd.mint(address(0xA05), 1e6);
        vm.prank(alice);
        ballots.vote(1, 2, hex"010101040404ff07", proof);
        assertEq(ballots.nonceOf(1), 2);
    }
}
