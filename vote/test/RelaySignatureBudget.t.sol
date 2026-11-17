// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Fixture, OwnedWallet} from "./helpers/Fixtures.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";

contract GasBurningSignature is IERC1271 {
    function isValidSignature(bytes32, bytes calldata) external view returns (bytes4) {
        uint256 before = gasleft();
        while (before - gasleft() < 8_000_000) {}
        return IERC1271.isValidSignature.selector;
    }
}

contract RelaySignatureBudgetTest is Fixture {
    // Match the sponsor's preflight policy. The API tests separately assert that the
    // locked RPC client forwards this budget and pins the final signed transaction.
    uint256 private constant PREFLIGHT_GAS = 500_000;

    function test_expensiveOwnerCannotPassBoundedPreflight() public {
        GasBurningSignature owner = new GasBurningSignature();
        vm.prank(address(ballots));
        (bool ok,) = address(owner).staticcall{gas: PREFLIGHT_GAS}(
            abi.encodeCall(IERC1271.isValidSignature, (bytes32(0), hex"1234"))
        );
        assertFalse(ok);
    }

    function test_ordinaryContractOwnerPassesBoundedPreflightAndRecords() public {
        OwnedWallet owner = new OwnedWallet(alice);
        vm.prank(alice);
        ballots.safeTransferFrom(alice, address(owner), 1);
        bytes32 digest = ballots.digestOf(1, 1, keccak256(ranks));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(1000, digest);
        bytes memory signature = abi.encodePacked(r, s, v);
        vm.prank(address(ballots));
        (bool ok, bytes memory result) = address(owner).staticcall{gas: PREFLIGHT_GAS}(
            abi.encodeCall(IERC1271.isValidSignature, (digest, signature))
        );
        assertTrue(ok);
        assertEq(abi.decode(result, (bytes4)), IERC1271.isValidSignature.selector);
        vm.warp(start);
        ballots.recordFor(1, 1, ranks, signature, proofOf(ranks));
        assertEq(ballots.nonceOf(1), 1);
    }
}
