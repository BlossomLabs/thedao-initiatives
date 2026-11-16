// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {SignedBallots} from "../contracts/SignedBallots.sol";
import {RoundAccounting} from "../contracts/RoundAccounting.sol";
import {MockToken, MockFeed} from "./helpers/Fixtures.sol";

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

    MockFeed internal ethFeed;
    MockToken internal usdc; // currency 2, fixed $1, six decimals
    MockToken internal dai; // currency 3, fixed $1, eighteen decimals
    MockToken internal whole; // currency 4, fixed $1, no decimals: one token is $1

    /// Four projects with the given goals and group masks (group 0 added when any mask is
    /// set), ETH at $3000 and a fixed-dollar token registered, the pool set, voting open.
    function priced(uint256[4] memory goals, uint256[4] memory masks, uint256 pool)
        internal
        returns (SignedBallots round)
    {
        round = fresh();
        round.addGroup("Seal");
        ethFeed = new MockFeed(8, 3_000e8);
        usdc = new MockToken(6);
        round.registerCurrency(address(0), address(ethFeed));
        round.registerCurrency(address(usdc), address(0));
        dai = new MockToken(18);
        whole = new MockToken(0);
        round.registerCurrency(address(dai), address(0));
        round.registerCurrency(address(whole), address(0));
        for (uint160 i; i < 4; ++i) {
            round.addInitiative(address(0x1000 + i), goals[i], false, masks[i]);
        }
        round.setPoolUsd(pool);
        vm.warp(round.opensAt());
    }

    function hundreds() internal pure returns (uint256[4] memory goals) {
        goals = [uint256(100e6), 100e6, 100e6, 100e6];
    }

    function unrelated() internal pure returns (uint256[4] memory masks) {}

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
        uint256[] memory goals = vm.parseJsonUintArray(json, string.concat(c, ".sol.goals"));
        uint256[] memory asks = vm.parseJsonUintArray(json, string.concat(c, ".sol.asks"));
        bool[] memory rfp = vm.parseJsonBoolArray(json, string.concat(c, ".sol.rfp"));
        uint256[] memory masks = vm.parseJsonUintArray(json, string.concat(c, ".sol.masks"));
        for (uint256 i; i < goals.length; ++i) {
            round.addInitiative(address(uint160(0x1000 + i)), goals[i], rfp[i], masks[i]);
            // A USD pledge converts 1:1, so goal minus ask of it leaves exactly the fixture's ask.
            if (goals[i] > asks[i]) round.setPledge(bytes32(i + 1), i, 0, goals[i] - asks[i]);
        }
        // Cases carrying `withdrawn` have an admin withdraw those projects first.
        if (vm.keyExistsJson(json, string.concat(c, ".withdrawn"))) {
            bool[] memory out = vm.parseJsonBoolArray(json, string.concat(c, ".withdrawn"));
            for (uint256 i; i < out.length; ++i) {
                if (out[i]) round.withdrawInitiative(i);
            }
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

    function test_groupsEditableWhenAddingIsOpen() public {
        SignedBallots round = simple();
        round.addGroup("Seal");
        // After opening, outside every quiet-ending span: a project joins a group.
        round.setInitiativeGroups(0, 1);
        round.setInitiativeGroups(1, 1);
        assertEq(round.initiative(0).groups, 1);
        assertEq(round.initiative(0).goalUsd, 100);
        assertEq(round.initiative(0).account, address(0x1000));
        // The rules apply to ballots sent from then on: 0 and 1 are related now.
        vm.prank(voter);
        vm.expectRevert(abi.encodeWithSelector(SignedBallots.BadProof.selector, uint8(0)));
        round.vote(1, 1, hex"010101ff", proof3(0, 1, 2));
        vm.prank(voter);
        round.vote(1, 1, hex"01ff0101", proof3(0, 2, 3));
        // And leaves it again.
        round.setInitiativeGroups(1, 0);
        assertEq(round.initiative(1).groups, 0);
    }

    function test_groupsEditClosedInsideQuietEnding() public {
        SignedBallots round = simple();
        round.addGroup("Seal");
        vm.warp(round.firstTallyAt(0));
        vm.expectRevert(SignedBallots.AddingClosed.selector);
        round.setInitiativeGroups(0, 1);
        vm.warp(round.latestSettlementAt(0));
        round.setInitiativeGroups(0, 1);
        vm.warp(round.hardDeadline());
        vm.expectRevert(SignedBallots.AddingClosed.selector);
        round.setInitiativeGroups(0, 0);
    }

    function test_groupsEditChecksTheGroups() public {
        SignedBallots round = fresh();
        round.addGroup("Seal");
        round.addInitiative(address(0x1000), 100, false, 0);
        round.addInitiative(address(0x1001), 100, true, 0);
        vm.expectRevert(RoundAccounting.UnknownGroup.selector);
        round.setInitiativeGroups(0, 2);
        vm.expectRevert(RoundAccounting.RfpWithGroups.selector);
        round.setInitiativeGroups(1, 1);
        vm.expectRevert(RoundAccounting.UnknownInitiative.selector);
        round.setInitiativeGroups(2, 1);
    }

    function test_groupsEditNeedsTheAdmin() public {
        SignedBallots round = simple();
        round.addGroup("Seal");
        vm.prank(voter);
        vm.expectRevert();
        round.setInitiativeGroups(0, 1);
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
        round.vote(1, 1, hex"01010104", proof3(0, 2, 3)); // 3 is not in S-Tier
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

    function test_independenceFreezesButInitiativesStayCorrectable() public {
        SignedBallots round = simple();
        round.setInitiative(0, address(0x1000), 1, false, 0);
        assertEq(round.initiative(0).goalUsd, 1);
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

    function test_donationMakesBallotTooSmall() public {
        SignedBallots round = priced(hundreds(), unrelated(), 200e6);
        vm.prank(voter);
        round.vote(1, 1, hex"01010101", proof3(0, 1, 2)); // asks 400 of 300 needed
        vm.deal(address(0x1000), 0.04 ether); // $120 covers project 0's $100
        vm.deal(address(0x1001), 0.04 ether);
        vm.prank(voter);
        vm.expectRevert(SignedBallots.BallotTooSmall.selector);
        round.vote(1, 2, hex"010101ff", proof3(0, 1, 2)); // asks 100 < 300, and project 3 still asks 100
    }

    /// Pool 200 wants 300; donations take every ask to 40 + 40 + 100 + 100 = 280, below that.
    function belowMinimum() internal returns (SignedBallots round) {
        round = priced(hundreds(), unrelated(), 200e6);
        vm.deal(address(0x1000), 0.02 ether); // $60
        vm.deal(address(0x1001), 0.02 ether);
    }

    function test_SizeRule_AllAsksBelowMinimum_PlacingEveryAskedProjectPasses() public {
        SignedBallots round = belowMinimum();
        vm.prank(voter);
        round.vote(1, 1, hex"01010101", proof3(0, 1, 2)); // asks 280 < 300, but nothing is left out
        assertEq(round.nonceOf(1), 1);
    }

    function test_SizeRule_AllAsksBelowMinimum_LeavingOneOutReverts() public {
        SignedBallots round = belowMinimum();
        vm.prank(voter);
        vm.expectRevert(SignedBallots.BallotTooSmall.selector);
        round.vote(1, 1, hex"010101ff", proof3(0, 1, 2)); // asks 180 of 280: project 3 still asks 100
    }

    function test_SizeRule_CoveredProjectsMayBeLeftOut() public {
        SignedBallots round = priced(hundreds(), unrelated(), 200e6);
        vm.deal(address(0x1000), 0.01 ether); // $30: ask 70
        vm.deal(address(0x1003), 0.04 ether); // $120: covered
        vm.prank(voter);
        round.vote(1, 1, hex"010101ff", proof3(0, 1, 2)); // asks 270 < 300, the one left out asks 0
        assertEq(round.nonceOf(1), 1);
    }

    function test_SizeRule_ShortBallotLeavesOutTheProjectsPastItsEnd() public {
        SignedBallots round = belowMinimum();
        vm.prank(voter);
        vm.expectRevert(SignedBallots.BallotTooSmall.selector);
        round.vote(1, 1, hex"010101", proof3(0, 1, 2)); // project 3 is past the end and asks 100
    }

    function test_SizeRule_HugePoolAndAsksDoNotOverflow() public {
        uint256 top = type(uint256).max;
        uint256[4] memory goals = [uint256(1 << 254), 1 << 254, 1 << 254, 0];
        // A pool above max/3 and placed asks past 2^255: neither makes the size rule panic.
        SignedBallots round = priced(goals, unrelated(), top);
        vm.prank(voter);
        round.vote(1, 1, hex"010101ff", proof3(0, 1, 2)); // nothing left out asks
        assertEq(round.nonceOf(1), 1);
        round = priced([uint256(1 << 254), 1 << 254, 1 << 254, 1 << 255], unrelated(), 1 << 200);
        vm.prank(voter);
        round.vote(1, 1, hex"010101ff", proof3(0, 1, 2)); // asks 3 * 2^254 >= 1.5 * 2^200
        assertEq(round.nonceOf(1), 1);
        round = priced([uint256(1 << 254), 1 << 254, 1 << 254, 1 << 255], unrelated(), top);
        vm.prank(voter);
        vm.expectRevert(SignedBallots.BallotTooSmall.selector);
        round.vote(1, 1, hex"010101ff", proof3(0, 1, 2)); // project 3 still asks
    }

    function test_pledgeCountsAgainstAsk() public {
        SignedBallots round = priced(hundreds(), unrelated(), 200e6);
        round.setPledge(bytes32(uint256(1)), 0, 0, 100e6);
        round.setPledge(bytes32(uint256(2)), 1, 0, 100e6);
        vm.prank(voter);
        vm.expectRevert(SignedBallots.BallotTooSmall.selector);
        round.vote(1, 1, hex"010101ff", proof3(0, 1, 2)); // asks 100 < 300, and project 3 still asks 100
        round.setPledge(bytes32(uint256(2)), 1, 0, 0); // cancelled: asks 300, half of 1.5x passes
        vm.prank(voter);
        round.vote(1, 1, hex"01010101", proof3(0, 1, 2));
    }

    function test_groupRuleCountsAsks() public {
        // Projects 0 and 1 share a group: 200 of 350 by goal, over half.
        uint256[4] memory goals = [uint256(100e6), 100e6, 100e6, 50e6];
        uint256[4] memory masks = [uint256(1), 1, 0, 0];
        SignedBallots round = priced(goals, masks, 150e6);
        vm.prank(voter);
        vm.expectRevert(abi.encodeWithSelector(SignedBallots.GroupOverHalf.selector, uint8(0), uint8(0)));
        round.vote(1, 1, hex"01010101", proof3(0, 2, 3));
        round.setPledge(bytes32(uint256(1)), 0, 0, 60e6); // asks 40 + 100 + 100 + 50: group 140 of 290
        vm.prank(voter);
        round.vote(1, 1, hex"01010101", proof3(0, 2, 3));
    }

    function test_groupOverHalfByAskNotByGoal() public {
        // Goals put the group at exactly half (200 of 400), which passes.
        uint256[4] memory masks = [uint256(1), 1, 0, 0];
        SignedBallots round = priced(hundreds(), masks, 150e6);
        vm.prank(voter);
        round.vote(1, 1, hex"01010101", proof3(0, 2, 3));
        round.setPledge(bytes32(uint256(1)), 2, 0, 60e6);
        round.setPledge(bytes32(uint256(2)), 3, 0, 60e6); // asks 100 + 100 + 40 + 40: group 200 of 280
        vm.prank(voter);
        vm.expectRevert(abi.encodeWithSelector(SignedBallots.GroupOverHalf.selector, uint8(0), uint8(0)));
        round.vote(1, 2, hex"01010101", proof3(0, 2, 3));
    }

    function test_coveredProjectCountsAsIndependent() public {
        SignedBallots round = priced(hundreds(), unrelated(), 200e6);
        round.setPledge(bytes32(uint256(1)), 0, 0, 100e6); // project 0 is fully pledged: ask $0
        vm.prank(voter);
        // S-Tier is projects 0, 1 and 2; project 3 in A-Tier. Asks 0 + 100 + 100 + 100 = 300 = 1.5x of 200.
        round.vote(1, 1, hex"01010104", proof3(0, 1, 2));
    }

    function test_shortBallotReadsOnlyItsProjects() public {
        SignedBallots round = priced(hundreds(), unrelated(), 200e6);
        vm.prank(voter);
        round.vote(1, 1, hex"01010101", proof3(0, 1, 2)); // the registration receipt, before S's deadline
        vm.warp(round.latestSettlementAt(0));
        round.addInitiative(address(0x2000), 100e6, false, 0);
        vm.expectCall(address(usdc), abi.encodeCall(MockToken.balanceOf, (address(0x2000))), 0);
        vm.prank(voter);
        round.vote(1, 2, hex"01010101", proof3(0, 1, 2));
    }

    function test_longBallotReadsItsProjects() public {
        SignedBallots round = priced(hundreds(), unrelated(), 200e6);
        vm.prank(voter);
        round.vote(1, 1, hex"01010101", proof3(0, 1, 2));
        vm.warp(round.latestSettlementAt(0));
        round.addInitiative(address(0x2000), 100e6, false, 0);
        vm.expectCall(address(usdc), abi.encodeCall(MockToken.balanceOf, (address(0x2000))), 1);
        vm.prank(voter);
        round.vote(1, 2, hex"0101010101", proof3(0, 1, 2));
    }

    function test_unplacedProjectIsNotRead() public {
        SignedBallots round = priced(hundreds(), unrelated(), 200e6);
        vm.expectCall(address(usdc), abi.encodeCall(MockToken.balanceOf, (address(0x1003))), 0);
        vm.prank(voter);
        round.vote(1, 1, hex"010101ff", proof3(0, 1, 2));
    }

    function test_brokenFeedDoesNotBlockVoting() public {
        SignedBallots round = priced(hundreds(), unrelated(), 200e6);
        vm.deal(address(0x1000), 0.04 ether);
        vm.deal(address(0x1001), 0.04 ether);
        ethFeed.setUnavailable(true);
        // The stored price ($3000) still counts the donations: asks 100 < 300, with project 3
        // left out. A zero price would have left asks at 300 and passed.
        vm.prank(voter);
        vm.expectRevert(SignedBallots.BallotTooSmall.selector);
        round.vote(1, 1, hex"010101ff", proof3(0, 1, 2));
        vm.deal(address(0x1001), 0);
        vm.prank(voter);
        round.vote(1, 1, hex"01010101", proof3(0, 1, 2)); // asks 300: recorded
        assertEq(round.nonceOf(1), 1);
    }

    function test_olderGoodAnswerUsedNotStoredByBallot() public {
        SignedBallots round = priced(hundreds(), unrelated(), 150e6);
        (uint192 storedPrice, uint64 storedAt) = round.lastPrice(1);
        vm.deal(address(0x1000), 0.04 ether);
        vm.deal(address(0x1001), 0.04 ether);
        // Needs asks >= 225. At $3000 each donation covers its project (asks 200: too small);
        // at the older $2000 answer each covers $80 (asks 240).
        ethFeed.set(2_000e8, storedAt - 1);
        vm.recordLogs();
        vm.prank(voter);
        round.vote(1, 1, hex"01010101", proof3(0, 1, 2));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            assertTrue(logs[i].topics[0] != RoundAccounting.PriceStored.selector);
        }
        (uint192 price, uint64 at) = round.lastPrice(1);
        assertEq(price, storedPrice);
        assertEq(at, storedAt);
    }

    function test_newerGoodAnswerStoredByBallot() public {
        SignedBallots round = priced(hundreds(), unrelated(), 200e6);
        ethFeed.set(4_000e8, block.timestamp);
        vm.expectEmit(true, false, false, true, address(round));
        emit RoundAccounting.PriceStored(1, 4_000e8, block.timestamp);
        vm.prank(voter);
        round.vote(1, 1, hex"01010101", proof3(0, 1, 2));
        (uint192 price, uint64 at) = round.lastPrice(1);
        assertEq(price, 4_000e8);
        assertEq(at, block.timestamp);
    }

    function test_eachPartRoundsDownOnItsOwn() public {
        // Project 0 holds 1.5e12 dai-wei and has a pledge of 1.5e12: each part is $0.000001
        // (rounded down), $0.000002 in all. Converted together they would be $0.000003.
        // Asks total 400e6 - 2; 3 x 266_666_665 = 799_999_995 sits between 2 x that and 2 x (400e6 - 3).
        SignedBallots round = priced(hundreds(), unrelated(), 266_666_665);
        dai.mint(address(0x1000), 1.5e12);
        round.setPledge(bytes32(uint256(1)), 0, 3, 1.5e12);
        (uint256 donated, uint256 pledged,, uint256 ask) = round.initiativeUsd(0);
        assertEq(donated, 1);
        assertEq(pledged, 1);
        assertEq(ask, 100e6 - 2);
        vm.prank(voter);
        round.vote(1, 1, hex"01010101", proof3(0, 1, 2));
    }

    function test_hugeBalanceDoesNotBlockBallot() public {
        SignedBallots round = priced(hundreds(), unrelated(), 60e6);
        // One balance would overflow the sum with a pledge; one overflows its own conversion.
        usdc.mint(address(0x1000), type(uint256).max);
        round.setPledge(bytes32(uint256(1)), 0, 2, 5);
        whole.mint(address(0x1001), type(uint256).max);
        dai.mint(address(0x1002), type(uint256).max);
        round.setPledge(bytes32(uint256(2)), 2, 3, type(uint256).max);
        for (uint256 i; i < 3; ++i) {
            (,, uint256 total, uint256 ask) = round.initiativeUsd(i);
            assertEq(ask, 0);
            assertGt(total, 100e6);
        }
        vm.prank(voter);
        round.vote(1, 1, hex"01010101", proof3(0, 1, 2)); // asks 0 + 0 + 0 + 100e6 against 1.5 x 60e6
    }

    function test_brokenOrMissingTokenCountsAsZero() public {
        SignedBallots round = priced(hundreds(), unrelated(), 200e6);
        vm.deal(address(0x1000), 0.02 ether); // $60: project 0 asks $40
        usdc.mint(address(0x1002), 100e6);
        usdc.setBroken(true);
        (,,, uint256 ask) = round.initiativeUsd(2);
        assertEq(ask, 100e6);
        vm.prank(voter);
        round.vote(1, 1, hex"01010101", proof3(0, 1, 2)); // asks 40 + 100 + 100 + 100 = 340e6
        vm.etch(address(usdc), "");
        (,,, ask) = round.initiativeUsd(2);
        assertEq(ask, 100e6);
        vm.prank(voter);
        round.vote(1, 2, hex"01010101", proof3(0, 1, 2));
        assertEq(round.nonceOf(1), 2);
    }
}
