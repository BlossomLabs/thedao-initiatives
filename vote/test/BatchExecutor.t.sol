// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {BatchExecutor} from "../contracts/BatchExecutor.sol";
import {SignedBallots} from "../contracts/SignedBallots.sol";

/// The Devcon deploy: the relayer EOA delegates to BatchExecutor (EIP-7702) and
/// sets the whole round up in one transaction to itself.
contract BatchExecutorTest is Test {
    uint64 constant C = 1793989800;
    address constant ADMIN = 0xf632Ce27Ea72deA30d30C1A9700B6b3bCeAA05cF;

    BatchExecutor impl;
    uint256 relayerKey = 0xA11CE;
    address relayer = vm.addr(relayerKey);
    SignedBallots round;

    function setUp() public {
        vm.warp(1793800000);
        impl = new BatchExecutor();
        vm.prank(relayer);
        round = new SignedBallots(
            relayer,
            address(0),
            "TheDAO Devcon 8",
            "DEVCON",
            SignedBallots.Schedule(uint64(block.timestamp + 30 minutes), 1, [C - 1, C, C + 1], 1)
        );
    }

    function setupCalls(uint256 initiatives) internal view returns (BatchExecutor.Call[] memory calls) {
        calls = new BatchExecutor.Call[](initiatives + 8);
        uint256 k;
        for (uint256 i; i < initiatives; ++i) {
            calls[k++] = BatchExecutor.Call(
                address(round), 0, abi.encodeCall(round.addInitiative, (address(uint160(0x1000 + i)), 1_000e6))
            );
        }
        calls[k++] = BatchExecutor.Call(address(round), 0, abi.encodeCall(round.setPoolUsd, (913_244e6)));
        bytes32[3] memory handed = [round.DEFAULT_ADMIN_ROLE(), round.ADMIN_ROLE(), round.PLEDGE_ROLE()];
        for (uint256 i; i < 3; ++i) {
            calls[k++] = BatchExecutor.Call(address(round), 0, abi.encodeCall(round.grantRole, (handed[i], ADMIN)));
        }
        bytes32[4] memory dropped = [handed[1], handed[2], round.BLOB_SUBMITTER_ROLE(), handed[0]];
        for (uint256 i; i < 4; ++i) {
            calls[k++] =
                BatchExecutor.Call(address(round), 0, abi.encodeCall(round.renounceRole, (dropped[i], relayer)));
        }
    }

    function test_oneTransactionSetsUpTheWholeRound() public {
        BatchExecutor.Call[] memory calls = setupCalls(81);
        vm.prank(relayer);
        vm.signAndAttachDelegation(address(impl), relayerKey);
        BatchExecutor(payable(relayer)).execute(calls);
        assertEq(round.initiativeCount(), 81);
        assertEq(round.poolUsd(), 913_244e6);
        assertTrue(round.hasRole(round.DEFAULT_ADMIN_ROLE(), ADMIN));
        assertTrue(round.hasRole(round.ADMIN_ROLE(), ADMIN));
        assertTrue(round.hasRole(round.PLEDGE_ROLE(), ADMIN));
        assertFalse(round.hasRole(round.DEFAULT_ADMIN_ROLE(), relayer));
        assertFalse(round.hasRole(round.ADMIN_ROLE(), relayer));
        assertFalse(round.hasRole(round.BLOB_SUBMITTER_ROLE(), relayer));
        assertTrue(round.hasRole(round.MINTER_ROLE(), relayer));
    }

    function test_onlyTheAccountItselfCanExecute() public {
        BatchExecutor.Call[] memory calls = setupCalls(1);
        vm.prank(makeAddr("stranger"));
        vm.signAndAttachDelegation(address(impl), relayerKey);
        vm.expectRevert(BatchExecutor.NotSelf.selector);
        BatchExecutor(payable(relayer)).execute(calls);
    }

    function test_aFailingStepRollsBackEverything() public {
        BatchExecutor.Call[] memory calls = setupCalls(3);
        // A duplicate initiative account makes step 2 revert.
        calls[1] = calls[0];
        vm.prank(relayer);
        vm.signAndAttachDelegation(address(impl), relayerKey);
        vm.expectPartialRevert(BatchExecutor.CallFailed.selector);
        BatchExecutor(payable(relayer)).execute(calls);
        assertEq(round.initiativeCount(), 0);
        assertTrue(round.hasRole(round.ADMIN_ROLE(), relayer));
    }

    function test_delegatedAccountStillReceivesEth() public {
        vm.signAndAttachDelegation(address(impl), relayerKey);
        vm.deal(address(this), 1 ether);
        (bool ok,) = payable(relayer).call{value: 1 ether}("");
        assertTrue(ok);
    }
}
