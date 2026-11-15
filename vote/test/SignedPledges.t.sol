// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Fixture, OwnedWallet} from "./helpers/Fixtures.sol";
import {SignedBallots} from "../contracts/SignedBallots.sol";

contract SignedPledgesTest is Fixture {
    event PledgeSet(bytes32 indexed pledgeId, uint256 indexed initiativeId, uint256 indexed currencyId, uint256 amount);

    uint256 internal constant ADMIN_KEY = 0xA11CE;
    bytes32 internal constant PID = keccak256("signed pledge");
    address internal constant ADDR = 0x5615dEB798BB3E4dFa0139dFa1b3D433Cc23b72f;
    bytes32 internal constant DIGEST = 0xa38e543043a73b990adad292ee97477ffd23066afbe77fe991c45606f90ccd4e;
    address internal admin;
    address internal relayer = address(0xBEEF);
    uint256 internal usd;

    function setUp() public override {
        super.setUp();
        admin = vm.addr(ADMIN_KEY);
        ballots.grantRole(ballots.PLEDGE_ROLE(), admin);
        usd = ballots.USD();
    }

    function sign(uint256 key, bytes32 id, uint256 amount, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = pledgeDigest(id, 0, usd, amount, nonce, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function pledgeDigest(bytes32 id, uint256 i, uint256 c, uint256 amount, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes32)
    {
        (, string memory name, string memory version, uint256 chainId, address verifying,,) = ballots.eip712Domain();
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes(version)),
                chainId,
                verifying
            )
        );
        bytes32 structHash =
            keccak256(abi.encode(ballots.PLEDGE_TYPEHASH(), id, i, c, amount, nonce, deadline));
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }

    function test_SignedPledge_RecordsLikeSetPledge() public {
        bytes memory sig = sign(ADMIN_KEY, PID, 4_000e6, 0, block.timestamp + 1 hours);
        vm.expectEmit(true, true, true, true);
        emit PledgeSet(PID, 0, usd, 4_000e6);
        vm.prank(relayer);
        ballots.setPledgeBySig(PID, 0, usd, 4_000e6, admin, 0, block.timestamp + 1 hours, sig);
        (,,, uint256 ask) = ballots.initiativeUsd(0);
        assertEq(ask, 16_000e6);
        assertEq(ballots.pledgeNonceOf(admin), 1);
    }

    function test_SignedPledge_AnyoneMaySubmit() public {
        bytes memory sig = sign(ADMIN_KEY, PID, 1e6, 0, block.timestamp + 1 hours);
        vm.prank(address(0x1234));
        ballots.setPledgeBySig(PID, 0, usd, 1e6, admin, 0, block.timestamp + 1 hours, sig);
        (, uint256 pledged,,) = ballots.initiativeUsd(0);
        assertEq(pledged, 1e6);
    }

    function test_SignedPledge_RevertsWithoutRole() public {
        uint256 key = 0xB0B;
        address nobody = vm.addr(key);
        bytes memory sig = sign(key, PID, 1e6, 0, block.timestamp + 1 hours);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, nobody, ballots.PLEDGE_ROLE()
            )
        );
        ballots.setPledgeBySig(PID, 0, usd, 1e6, nobody, 0, block.timestamp + 1 hours, sig);
    }

    function test_SignedPledge_RevertsOnReplay() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = sign(ADMIN_KEY, PID, 1e6, 0, deadline);
        ballots.setPledgeBySig(PID, 0, usd, 1e6, admin, 0, deadline, sig);
        vm.expectRevert(abi.encodeWithSelector(SignedBallots.InvalidPledgeNonce.selector, admin, 0));
        ballots.setPledgeBySig(PID, 0, usd, 1e6, admin, 0, deadline, sig);
    }

    function test_SignedPledge_RevertsWhenExpired() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = sign(ADMIN_KEY, PID, 1e6, 0, deadline);
        vm.warp(deadline + 1);
        vm.expectRevert(SignedBallots.PledgeExpired.selector);
        ballots.setPledgeBySig(PID, 0, usd, 1e6, admin, 0, deadline, sig);
        vm.warp(deadline); // the deadline itself is still valid
        ballots.setPledgeBySig(PID, 0, usd, 1e6, admin, 0, deadline, sig);
    }

    function test_SignedPledge_RevertsOnWrongSigner() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = sign(0xB0B, PID, 1e6, 0, deadline); // signed by someone else, claimed as admin
        vm.expectRevert(SignedBallots.InvalidSignature.selector);
        ballots.setPledgeBySig(PID, 0, usd, 1e6, admin, 0, deadline, sig);
        // A changed amount does not match the signature either.
        sig = sign(ADMIN_KEY, PID, 1e6, 0, deadline);
        vm.expectRevert(SignedBallots.InvalidSignature.selector);
        ballots.setPledgeBySig(PID, 0, usd, 2e6, admin, 0, deadline, sig);
    }

    function test_SignedPledge_ContractWalletSigner() public {
        OwnedWallet wallet = new OwnedWallet(admin);
        ballots.grantRole(ballots.PLEDGE_ROLE(), address(wallet));
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = pledgeDigest(PID, 0, usd, 3e6, 0, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ADMIN_KEY, digest);
        ballots.setPledgeBySig(PID, 0, usd, 3e6, address(wallet), 0, deadline, abi.encodePacked(r, s, v));
        (, uint256 pledged,,) = ballots.initiativeUsd(0);
        assertEq(pledged, 3e6);
        assertEq(ballots.pledgeNonceOf(address(wallet)), 1);
    }

    function test_SignedPledge_ClosedAtHardDeadline() public {
        uint256 deadline = uint256(ballots.hardDeadline()) + 1 days;
        bytes memory sig = sign(ADMIN_KEY, PID, 1e6, 0, deadline);
        vm.warp(ballots.hardDeadline());
        vm.expectRevert(SignedBallots.VotingClosed.selector);
        ballots.setPledgeBySig(PID, 0, usd, 1e6, admin, 0, deadline, sig);
    }

    function test_SignedPledge_Digest() public {
        // Fixed inputs; shared/vote/typed-data.test.ts hashes the same message for the same contract.
        bytes32 id = bytes32(uint256(0xabc));
        bytes32 digest = pledgeDigest(id, 2, 1, 5_000_000, 7, 1_900_000_000);
        assertEq(block.chainid, 31337);
        assertEq(address(ballots), ADDR);
        assertEq(digest, DIGEST);
    }
}
