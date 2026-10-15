// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {SignedBallots} from "../../contracts/SignedBallots.sol";
import {IPriceFeed} from "../../contracts/IPriceFeed.sol";

contract MockNFT is ERC721 {
    constructor() ERC721("External badge", "BADGE") {}

    function mint(address to, uint256 id) external {
        _mint(to, id);
    }
}

contract MockToken {
    uint8 public decimals;
    mapping(address => uint256) public balanceOf;

    constructor(uint8 decimals_) {
        decimals = decimals_;
    }

    function setDecimals(uint8 value) external {
        decimals = value;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MockFeed is IPriceFeed {
    uint8 public override decimals;
    uint80 public round = 1;
    int256 public price;
    uint256 public updatedAt;
    bool public unavailable;

    constructor(uint8 decimals_, int256 price_) {
        decimals = decimals_;
        price = price_;
        updatedAt = block.timestamp;
    }

    function set(int256 price_, uint256 timestamp) external {
        ++round;
        price = price_;
        updatedAt = timestamp;
    }

    function setDecimals(uint8 decimals_) external {
        decimals = decimals_;
    }

    function setRound(uint80 round_) external {
        round = round_;
    }

    function setUnavailable(bool value) external {
        unavailable = value;
    }

    function latestRoundData() external view override returns (uint80, int256, uint256, uint256, uint80) {
        require(!unavailable, "unavailable");
        return (round, price, updatedAt, updatedAt, round);
    }
}

    contract OwnedWallet is IERC1271, IERC721Receiver {
        address public immutable owner;

        constructor(address owner_) {
            owner = owner_;
        }

        function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
            return ECDSA.recover(hash, signature) == owner ? IERC1271.isValidSignature.selector : bytes4(0xffffffff);
        }

        function execute(address target, bytes calldata data) external {
            require(msg.sender == owner, "owner");
            (bool ok, bytes memory result) = target.call(data);
            if (!ok) assembly ("memory-safe") { revert(add(result, 32), mload(result)) }
        }

        function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
            return IERC721Receiver.onERC721Received.selector;
        }
    }

    abstract contract Fixture is Test {
        SignedBallots internal ballots;
        address internal alice;
        address internal bob;
        address internal constant INITIATIVE_A = address(0xA01);
        address internal constant INITIATIVE_B = address(0xA02);
        address internal constant INITIATIVE_C = address(0xA03);
        uint64 internal start;
        bytes internal ranks = hex"0102ff";

        function setUp() public virtual {
            vm.warp(1_000_000);
            alice = vm.addr(1000);
            bob = vm.addr(2000);
            SignedBallots.Schedule memory s = schedule();
            start = s.opensAt;
            ballots = new SignedBallots(address(this), address(0), "Blossom voter", "VOTE", s);
            ballots.addInitiative(INITIATIVE_A, 20_000e6);
            ballots.addInitiative(INITIATIVE_B, 10_000e6);
            ballots.addInitiative(INITIATIVE_C, 5_000e6);
            ballots.mint(alice, 1);
            ballots.mint(alice, 2);
            ballots.mint(bob, 3);
            ballots.setPoolUsd(0); // Explicit initialization before S's first tally.
        }

        function schedule() internal view returns (SignedBallots.Schedule memory s) {
            s.opensAt = uint64(block.timestamp + 100);
            s.initialWindow = 1 days;
            s.maxWindows = 4;
            s.firstTallyAt[0] = s.opensAt + 7 days;
            s.firstTallyAt[1] = s.firstTallyAt[0] + 2 days;
            s.firstTallyAt[2] = s.firstTallyAt[1] + 2 days;
        }

        function signedVote(uint256 key, uint256 tokenId, uint64 nonce, bytes memory ballot)
            internal
            view
            returns (SignedBallots.Vote[] memory votes)
        {
            votes = new SignedBallots.Vote[](1);
            (bytes32 r, bytes32 vs) = vm.signCompact(key, ballots.digestOf(tokenId, nonce, keccak256(ballot)));
            votes[0] = SignedBallots.Vote(tokenId, nonce, r, vs, ballot);
        }

        function blobVotes(SignedBallots.Vote[] memory votes)
            internal
            pure
            returns (SignedBallots.BlobVote[] memory hashes)
        {
            hashes = new SignedBallots.BlobVote[](votes.length);
            for (uint256 i; i < votes.length; ++i) {
                hashes[i] = SignedBallots.BlobVote(
                    votes[i].tokenId, votes[i].nonce, votes[i].r, votes[i].vs, keccak256(votes[i].ballot)
                );
            }
        }

        function attachBlob() internal returns (bytes32 hash) {
            bytes32[] memory hashes = new bytes32[](1);
            hash = bytes32(uint256(0x01) << 248 | 0xb10b);
            hashes[0] = hash;
            vm.blobhashes(hashes);
        }
    }
