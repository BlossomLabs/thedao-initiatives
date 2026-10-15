// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Fixture, MockNFT, OwnedWallet} from "./helpers/Fixtures.sol";
import {SignedBallots} from "../contracts/SignedBallots.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

contract SignedBallotsTest is Fixture {
    function test_internalNFTAndRoles() public view {
        assertEq(ballots.eligibilityNFT(), address(ballots));
        assertEq(ballots.ownerOf(1), alice);
        assertEq(ballots.balanceOf(alice), 2);
        assertTrue(ballots.hasRole(ballots.ADMIN_ROLE(), address(this)));
        assertTrue(ballots.supportsInterface(type(IERC721).interfaceId));
        assertTrue(ballots.supportsInterface(type(IAccessControl).interfaceId));
    }

    function test_eachNFTGetsItsOwnBallotEvenWithOneOwner() public {
        vm.warp(start);
        vm.startPrank(alice);
        ballots.vote(1, 1, ranks);
        ballots.vote(2, 1, hex"0201ff");
        vm.stopPrank();
        assertEq(ballots.registrationReceiptCount(), 2);
        assertEq(ballots.nonceOf(1), 1);
        assertEq(ballots.nonceOf(2), 1);
        assertEq(ballots.ballotHashOf(1), keccak256(ranks));
        assertTrue(ballots.ballotHashOf(1) != ballots.ballotHashOf(2));
    }

    function test_batchRegistersManyIndependentNFTs() public {
        uint256 n = 40;
        SignedBallots.Vote[] memory votes = new SignedBallots.Vote[](n);
        for (uint256 i; i < n; ++i) {
            uint256 tokenId = 100 + i;
            uint256 key = 10_000 + i;
            ballots.mint(vm.addr(key), tokenId);
            (bytes32 r, bytes32 vs) = vm.signCompact(key, ballots.digestOf(tokenId, 1, keccak256(ranks)));
            votes[i] = SignedBallots.Vote(tokenId, 1, r, vs, ranks);
        }
        vm.warp(start);
        ballots.record(votes);
        assertEq(ballots.registrationReceiptCount(), n);
        assertEq(ballots.recordCount(), n);
        assertEq(ballots.nonceOf(139), 1);
    }

    function test_signedReceiptsCommitTokenAndOwner() public {
        vm.warp(start);
        SignedBallots.Vote[] memory votes = signedVote(1000, 1, 1, ranks);
        vm.expectEmit();
        emit SignedBallots.RegistrationReceipt(1);
        vm.expectEmit();
        emit SignedBallots.BallotRecorded(1, alice, 1, ranks);
        ballots.record(votes);
        assertEq(ballots.recordCount(), 1);
        assertEq(
            ballots.transcript(),
            keccak256(abi.encode(bytes32(0), uint256(1), alice, uint64(1), keccak256(ranks), bytes32(0)))
        );
    }

    function test_tamperingWithBallotOrTokenIdRejects() public {
        vm.warp(start);
        SignedBallots.Vote[] memory votes = signedVote(1000, 1, 1, ranks);
        votes[0].ballot = hex"0201ff";
        vm.expectRevert(SignedBallots.InvalidSignature.selector);
        ballots.record(votes);
        votes = signedVote(1000, 1, 1, ranks);
        votes[0].tokenId = 2; // Same owner, different voting unit.
        vm.expectRevert(SignedBallots.InvalidSignature.selector);
        ballots.record(votes);
        assertEq(ballots.registrationReceiptCount(), 0);
    }

    function test_signatureCannotBeReplayedInAnotherRound() public {
        SignedBallots other = new SignedBallots(address(this), address(ballots), "Other", "OTHER", schedule());
        other.addInitiative(INITIATIVE_A, 20_000e6);
        other.addInitiative(INITIATIVE_B, 10_000e6);
        other.addInitiative(INITIATIVE_C, 5_000e6);
        vm.warp(start);
        SignedBallots.Vote[] memory votes = signedVote(1000, 1, 1, ranks);
        vm.expectRevert(SignedBallots.InvalidSignature.selector);
        other.record(votes);
    }

    function test_signatureCannotBeReplayedOnAnotherChain() public {
        vm.warp(start);
        SignedBallots.Vote[] memory votes = signedVote(1000, 1, 1, ranks);
        vm.chainId(block.chainid + 1);
        vm.expectRevert(SignedBallots.InvalidSignature.selector);
        ballots.record(votes);
    }

    function test_noncePersistsAcrossTransfersAndRollDoesNotGrow() public {
        vm.warp(start);
        SignedBallots.Vote[] memory oldSignature = signedVote(1000, 1, 9, ranks);
        vm.startPrank(alice);
        ballots.vote(1, 5, ranks);
        ballots.transferFrom(alice, bob, 1);
        vm.stopPrank();
        vm.warp(ballots.registrationDeadline());
        vm.prank(bob);
        ballots.vote(1, 6, hex"0201ff");
        assertEq(ballots.registrationReceiptCount(), 1);
        assertEq(ballots.nonceOf(1), 6);
        vm.expectRevert(SignedBallots.InvalidSignature.selector);
        ballots.record(oldSignature);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(SignedBallots.StaleNonce.selector, 1, uint64(5)));
        ballots.vote(1, 5, ranks);
    }

    function test_approvedOperatorCannotVoteAsOwner() public {
        vm.prank(alice);
        ballots.approve(bob, 1);
        vm.warp(start);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(SignedBallots.NotNFTOwner.selector, 1));
        ballots.vote(1, 1, ranks);
    }

    function test_registrationDeadlineIsDerivedAndExclusive() public {
        assertEq(ballots.registrationDeadline(), ballots.firstTallyAt(0) + ballots.initialWindow());
        vm.warp(ballots.registrationDeadline() - 1);
        vm.prank(alice);
        ballots.vote(1, 1, ranks);
        vm.warp(ballots.registrationDeadline());
        vm.prank(alice);
        ballots.vote(1, 2, ranks);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SignedBallots.NotRegistered.selector, 2));
        ballots.vote(2, 1, ranks);
        vm.expectRevert(SignedBallots.RegistrationClosed.selector);
        ballots.mint(bob, 4);
    }

    function test_replacementsUseStrictlyIncreasingNonces() public {
        vm.warp(start);
        ballots.record(signedVote(1000, 1, 5, ranks));
        ballots.record(signedVote(1000, 1, 6, ranks));
        SignedBallots.Vote[] memory old = signedVote(1000, 1, 5, ranks);
        vm.expectRevert(abi.encodeWithSelector(SignedBallots.StaleNonce.selector, 1, uint64(5)));
        ballots.record(old);
    }

    function test_blobSignatureUsesSameNFTNonceAndTranscript() public {
        vm.warp(start);
        SignedBallots.Vote[] memory votes = signedVote(1000, 1, 1, ranks);
        bytes32 hash = attachBlob();
        ballots.recordBlob(0, blobVotes(votes));
        assertEq(
            ballots.transcript(),
            keccak256(abi.encode(bytes32(0), uint256(1), alice, uint64(1), keccak256(ranks), hash))
        );
        vm.expectRevert(abi.encodeWithSelector(SignedBallots.StaleNonce.selector, 1, uint64(1)));
        ballots.record(votes);
    }

    function test_blobRequiresRoleAndAttachedBlob() public {
        vm.warp(start);
        SignedBallots.BlobVote[] memory votes = blobVotes(signedVote(1000, 1, 1, ranks));
        vm.prank(bob);
        vm.expectRevert();
        ballots.recordBlob(0, votes);
        vm.expectRevert(SignedBallots.NoBlob.selector);
        ballots.recordBlob(0, votes);
        ballots.grantRole(ballots.BLOB_SUBMITTER_ROLE(), bob);
        attachBlob();
        vm.prank(bob);
        ballots.recordBlob(0, votes);
        assertEq(ballots.nonceOf(1), 1);
    }

    function test_blobReceiptIsOnlyCandidateRegistration() public {
        vm.warp(start);
        // The registry cannot inspect this invalid ballot inside a blob. Replay
        // must reject it and exclude it from the accepted roll.
        bytes memory malformed = hex"ff";
        attachBlob();
        ballots.recordBlob(0, blobVotes(signedVote(1000, 1, 1, malformed)));
        assertTrue(ballots.hasRegistrationReceipt(1));
        assertEq(ballots.recordCount(), 1);
    }

    function test_validTiesAndExplicitWithholding() public {
        vm.warp(start);
        vm.startPrank(alice);
        ballots.vote(1, 1, hex"010103");
        ballots.vote(1, 2, hex"ffffff");
        vm.stopPrank();
    }

    function test_invalidRanksAndLengthsRevert() public {
        vm.warp(start);
        vm.startPrank(alice);
        vm.expectRevert(SignedBallots.WrongLength.selector);
        ballots.vote(1, 1, hex"0102");
        vm.expectRevert(SignedBallots.InvalidBallot.selector);
        ballots.vote(1, 1, hex"0103ff");
        vm.expectRevert(SignedBallots.InvalidBallot.selector);
        ballots.vote(1, 1, hex"010004");
        vm.expectRevert(SignedBallots.InvalidBallot.selector);
        ballots.vote(1, 1, hex"010200");
        vm.stopPrank();
        assertEq(ballots.recordCount(), 0);
    }

    function test_failedBatchIsAtomic() public {
        vm.warp(start);
        SignedBallots.Vote[] memory first = signedVote(1000, 1, 1, ranks);
        SignedBallots.Vote[] memory second = signedVote(1000, 2, 1, ranks);
        SignedBallots.Vote[] memory votes = new SignedBallots.Vote[](2);
        votes[0] = first[0];
        votes[1] = second[0];
        votes[1].ballot = hex"0201ff";
        vm.expectRevert(SignedBallots.InvalidSignature.selector);
        ballots.record(votes);
        assertEq(ballots.recordCount(), 0);
        assertEq(ballots.nonceOf(1), 0);
        assertFalse(ballots.hasRegistrationReceipt(1));
    }

    function test_erc1271OwnerAndDirectContractWalletVote() public {
        OwnedWallet wallet = new OwnedWallet(vm.addr(7));
        ballots.mint(address(wallet), 7);
        vm.warp(start);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(7, ballots.digestOf(7, 1, keccak256(ranks)));
        ballots.recordFor(7, 1, ranks, abi.encodePacked(r, s, v));
        vm.prank(vm.addr(7));
        wallet.execute(address(ballots), abi.encodeCall(SignedBallots.vote, (7, 2, ranks)));
        assertEq(ballots.nonceOf(7), 2);
        (v, r, s) = vm.sign(8, ballots.digestOf(7, 3, keccak256(ranks)));
        vm.expectRevert(SignedBallots.InvalidSignature.selector);
        ballots.recordFor(7, 3, ranks, abi.encodePacked(r, s, v));
    }

    function test_genericEOASignatureRelay() public {
        vm.warp(start);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(1000, ballots.digestOf(1, 1, keccak256(ranks)));
        ballots.recordFor(1, 1, ranks, abi.encodePacked(r, s, v));
        assertEq(ballots.nonceOf(1), 1);
    }

    function test_externalNFTUsesTokenIdZeroAndDoesNotMintInternally() public {
        MockNFT nft = new MockNFT();
        nft.mint(alice, 0);
        nft.mint(alice, 999);
        SignedBallots externalRound = new SignedBallots(address(this), address(nft), "Unused", "EXT", schedule());
        externalRound.addInitiative(INITIATIVE_A, 1e6);
        vm.expectRevert(SignedBallots.ExternalCollection.selector);
        externalRound.mint(alice, 1);
        vm.warp(start);
        vm.startPrank(alice);
        externalRound.vote(0, 1, hex"01");
        externalRound.vote(999, 1, hex"ff");
        vm.stopPrank();
        assertEq(externalRound.registrationReceiptCount(), 2);
        assertEq(externalRound.nonceOf(0), 1);
    }

    function test_windowCountIncludesInitialWindow() public view {
        assertEq(ballots.windowDuration(1), 24 hours);
        assertEq(ballots.windowDuration(4), 3 hours);
        assertEq(ballots.maximumTierDuration(), 45 hours);
        assertEq(ballots.windowCutoff(0, 1), ballots.registrationDeadline());
        assertEq(ballots.windowCutoff(0, 4), ballots.latestSettlementAt(0));
        assertEq(ballots.latestSettlementAt(2), ballots.hardDeadline());
    }

    function test_invalidWindowIndicesRevert() public {
        vm.expectRevert(SignedBallots.InvalidSchedule.selector);
        ballots.windowDuration(0);
        vm.expectRevert(SignedBallots.InvalidSchedule.selector);
        ballots.windowCutoff(3, 1);
        vm.expectRevert(SignedBallots.InvalidSchedule.selector);
        ballots.windowCutoff(0, 5);
    }

    function test_invalidSchedulesRevert() public {
        SignedBallots.Schedule memory s = schedule();
        s.maxWindows = 0;
        vm.expectRevert(SignedBallots.InvalidSchedule.selector);
        new SignedBallots(address(this), address(0), "V", "V", s);
        s = schedule();
        s.initialWindow = 1;
        vm.expectRevert(SignedBallots.InvalidSchedule.selector);
        new SignedBallots(address(this), address(0), "V", "V", s);
        s = schedule();
        s.firstTallyAt[1] = s.firstTallyAt[0] + 1;
        vm.expectRevert(SignedBallots.InvalidSchedule.selector);
        new SignedBallots(address(this), address(0), "V", "V", s);
        s = schedule();
        s.firstTallyAt[2] = type(uint64).max;
        vm.expectRevert(SignedBallots.InvalidSchedule.selector);
        new SignedBallots(address(this), address(0), "V", "V", s);
    }

    function test_singleWindowAndGapsAreAllowed() public {
        SignedBallots.Schedule memory s = schedule();
        s.maxWindows = 1;
        SignedBallots round = new SignedBallots(address(this), address(0), "V", "V", s);
        assertEq(round.maximumTierDuration(), 1 days);
        assertEq(round.windowCutoff(0, 1), round.registrationDeadline());
    }

    function test_configurationFreezesAtStartAndRolesAreEnforced() public {
        vm.prank(bob);
        vm.expectRevert();
        ballots.mint(bob, 4);
        vm.prank(bob);
        vm.expectRevert();
        ballots.addInitiative(address(0xB00), 1e6);
        ballots.setBaseURI("ipfs://badges/");
        assertEq(ballots.tokenURI(1), "ipfs://badges/1");
        vm.warp(start);
        vm.expectRevert(SignedBallots.ConfigurationFrozen.selector);
        ballots.addInitiative(address(0xB00), 1e6);
        vm.expectRevert(SignedBallots.ConfigurationFrozen.selector);
        ballots.setInitiative(0, INITIATIVE_A, 1e6);
    }

    function test_startAndHardDeadlineBoundAllReceiptPaths() public {
        vm.prank(alice);
        vm.expectRevert(SignedBallots.VotingNotStarted.selector);
        ballots.vote(1, 1, ranks);
        vm.warp(start);
        vm.expectRevert(SignedBallots.NoVotes.selector);
        ballots.record(new SignedBallots.Vote[](0));
        SignedBallots.Vote[] memory votes = signedVote(1000, 1, 1, ranks);
        vm.warp(ballots.hardDeadline());
        vm.expectRevert(SignedBallots.VotingClosed.selector);
        ballots.record(votes);
        vm.prank(alice);
        vm.expectRevert(SignedBallots.VotingClosed.selector);
        ballots.vote(1, 1, ranks);
        vm.expectRevert(SignedBallots.VotingClosed.selector);
        ballots.recordFor(1, 1, ranks, "");
        attachBlob();
        vm.expectRevert(SignedBallots.VotingClosed.selector);
        ballots.recordBlob(0, blobVotes(votes));
    }

    function testFuzz_windowDurationBound(uint32 initial, uint8 count) public {
        initial = uint32(bound(initial, 1, 1 days));
        uint8 largest = 1;
        for (uint256 n = initial; n > 1 && largest < 10; n >>= 1) {
            ++largest;
        }
        count = uint8(bound(count, 1, largest));
        SignedBallots.Schedule memory s = schedule();
        s.initialWindow = initial;
        s.maxWindows = count;
        SignedBallots round = new SignedBallots(address(this), address(0), "V", "V", s);
        uint256 sum;
        for (uint8 k = 1; k <= count; ++k) {
            sum += round.windowDuration(k);
        }
        assertEq(sum, round.maximumTierDuration());
        assertGt(round.windowDuration(count), 0);
        assertLt(sum, 2 * uint256(initial));
    }
}
