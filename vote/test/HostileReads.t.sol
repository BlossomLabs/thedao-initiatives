// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {SignedBallots} from "../contracts/SignedBallots.sol";
import {MockFeed} from "./helpers/Fixtures.sol";

/// A token that behaves at registration, then (after an "upgrade") returns a big zero blob
/// from balanceOf.
contract BlobToken {
    uint256 public bytesOut;

    function decimals() external pure returns (uint8) {
        return 6;
    }

    function setBlob(uint256 n) external {
        bytesOut = n;
    }

    function balanceOf(address) external view returns (uint256) {
        uint256 n = bytesOut;
        if (n == 0) return 0;
        assembly {
            return(0x1000, n)
        }
    }
}

/// A feed that answers decimals honestly but returns a big zero blob from latestRoundData.
contract BlobFeed {
    function decimals() external pure returns (uint8) {
        return 8;
    }

    function latestRoundData() external pure returns (uint80, int256, uint256, uint256, uint80) {
        assembly {
            return(0x1000, 100000)
        }
    }
}

/// A token or feed that returns a huge return (or revert) blob costs the ballot only the
/// bytes the contract asks for, so a full ballot stays far below the per-transaction cap.
contract HostileReadsTest is Test {
    uint256 constant M = 40;
    uint256 constant BLOB = 100_000;
    uint256 constant GAS_LIMIT = 3_000_000;
    address voter = vm.addr(1000);
    SignedBallots round;
    MockFeed ethFeed;
    BlobToken blob;

    function setUp() public {
        vm.warp(1_000_000);
        SignedBallots.Schedule memory s;
        s.opensAt = uint64(block.timestamp + 100);
        s.initialWindow = 1 days;
        s.maxWindows = 4;
        s.firstTallyAt[0] = s.opensAt + 7 days;
        s.firstTallyAt[1] = s.firstTallyAt[0] + 3 days;
        s.firstTallyAt[2] = s.firstTallyAt[1] + 3 days;
        round = new SignedBallots(address(this), address(0), "Voter", "VOTE", s);
        ethFeed = new MockFeed(8, 3_000e8);
        round.registerCurrency(address(0), address(ethFeed));
        blob = new BlobToken();
        round.registerCurrency(address(blob), address(0));
        for (uint256 i; i < M; ++i) {
            round.addInitiative(address(uint160(0x10000 + i)), 100_000e6, false, 0);
        }
        round.mint(voter, 1);
        round.setPoolUsd(10_000e6);
        vm.warp(round.opensAt());
    }

    /// Records a ballot placing every project (three in S-Tier, the rest in B-Tier) and returns its gas.
    function sendFullBallot() internal returns (uint256) {
        bytes memory b = new bytes(M);
        for (uint256 i; i < M; ++i) {
            b[i] = bytes1(uint8(i < 3 ? 1 : 4));
        }
        uint8[] memory proof = new uint8[](3);
        (proof[0], proof[1], proof[2]) = (0, 1, 2);
        vm.prank(voter);
        round.vote{gas: 16_777_216}(1, 1, b, proof);
        return vm.lastCallGas().gasTotalUsed;
    }

    function test_blobBalanceKeepsFullBallotCheap() public {
        blob.setBlob(BLOB);
        uint256 used = sendFullBallot();
        assertLt(used, GAS_LIMIT);
        (,,, uint256 ask) = round.initiativeUsd(0);
        assertEq(ask, 100_000e6); // the blob's balance counts as zero
    }

    /// Against an honest token, the blob costs at most the gas each read forwards (50k): the
    /// callee's own work, never a copy of what it returns.
    function test_blobBalanceCostsAtMostTheReadGasPerProject() public {
        uint256 snap = vm.snapshotState();
        uint256 honest = sendFullBallot();
        vm.revertToState(snap);
        blob.setBlob(BLOB);
        uint256 hostile = sendFullBallot();
        assertLt(hostile, honest + M * 50_000);
    }

    function test_blobFeedAnswerFallsBackAndStaysCheap() public {
        vm.etch(address(ethFeed), address(new BlobFeed()).code);
        blob.setBlob(BLOB);
        uint256 used = sendFullBallot();
        assertLt(used, GAS_LIMIT);
        assertEq(round.priceUsd(1), 3_000e8); // the stored last price
    }
}
