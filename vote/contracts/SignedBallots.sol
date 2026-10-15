// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {RoundAccounting} from "./RoundAccounting.sol";

/// @notice NFT-keyed ballot receipts, an explicitly configured Slow Quiet Ending schedule,
///         and an increase-only USD pool. Each token ID has one voting unit.
/// @dev DRAFT. Checkpoints, actual tier settlement, and accepted blob ballots are
///      derived by replay, not asserted by an admin or by this receipt registry.
///      Records can be submitted until the last possible scheduled end. Replay
///      must reject revisions after actual early settlement or violating locks.
contract SignedBallots is ERC721, EIP712, RoundAccounting {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BLOB_SUBMITTER_ROLE = keccak256("BLOB_SUBMITTER_ROLE");
    bytes32 public constant VOTE_TYPEHASH = keccak256("Vote(uint256 tokenId,address voter,uint64 nonce,bytes ballot)");

    error InvalidSchedule();
    error ConfigurationFrozen();
    error DateAlreadyStarted();
    error InitialFundingTooLate();
    error VotingNotStarted();
    error VotingClosed();
    error RegistrationClosed();
    error NotRegistered(uint256 tokenId);
    error ExternalCollection();
    error InvalidNFTCollection();
    error NotNFTOwner(uint256 tokenId);
    error NoVotes();
    error NoProjects();
    error WrongLength();
    error InvalidBallot();
    error NoBlob();
    error StaleNonce(uint256 tokenId, uint64 nonce);
    error InvalidSignature();

    struct Schedule {
        uint64 opensAt;
        uint64 initialWindow;
        uint64[3] firstTallyAt;
        uint8 maxWindows;
    }

    struct Vote {
        uint256 tokenId;
        uint64 nonce;
        bytes32 r;
        bytes32 vs;
        bytes ballot;
    }

    struct BlobVote {
        uint256 tokenId;
        uint64 nonce;
        bytes32 r;
        bytes32 vs;
        bytes32 ballotHash;
    }

    address public immutable eligibilityNFT;
    uint64 public opensAt;
    uint64 public immutable initialWindow;
    uint8 public immutable maxWindows;
    /// @notice Admin-configured tally dates. Started tiers cannot be rescheduled.
    uint64[3] public firstTallyAt;
    uint64 public registrationDeadline;
    uint64 public immutable maximumTierDuration;
    uint64 public hardDeadline;
    string private _metadataBaseURI;

    mapping(uint256 tokenId => uint64 nonce) public nonceOf;
    mapping(uint256 tokenId => bytes32 ballotHash) public ballotHashOf;
    /// @notice A candidate roll from timely receipts. Blob contents and acceptance
    ///         still need replay; this is not an assertion of an accepted ballot.
    mapping(uint256 tokenId => bool) public hasRegistrationReceipt;
    uint256 public registrationReceiptCount;
    bytes32 public transcript;
    uint256 public recordCount;

    event ScheduleConfigured(
        uint64 opensAt,
        uint64 initialWindow,
        uint64[3] firstTallyAt,
        uint8 maxWindows,
        uint64 registrationDeadline,
        uint64 hardDeadline
    );
    event EligibilityConfigured(address indexed collection);
    event RegistrationReceipt(uint256 indexed tokenId);
    event BallotRecorded(uint256 indexed tokenId, address indexed voter, uint64 nonce, bytes ballot);
    event BlobBallotRecorded(
        uint256 indexed tokenId, address indexed voter, uint64 nonce, bytes32 ballotHash, bytes32 indexed blobHash
    );
    event MetadataBaseURISet(string baseURI);

    constructor(
        address admin,
        address externalNFT,
        string memory name_,
        string memory symbol_,
        Schedule memory schedule
    ) ERC721(name_, symbol_) EIP712("BlossomBallots", "2") RoundAccounting(admin) {
        if (schedule.opensAt <= block.timestamp) revert InvalidSchedule();
        uint256 duration = _validateSchedule(schedule);
        opensAt = schedule.opensAt;
        initialWindow = schedule.initialWindow;
        maxWindows = schedule.maxWindows;
        firstTallyAt = schedule.firstTallyAt;
        maximumTierDuration = uint64(duration);
        registrationDeadline = uint64(uint256(schedule.firstTallyAt[0]) + schedule.initialWindow);
        hardDeadline = uint64(uint256(schedule.firstTallyAt[2]) + duration);
        if (externalNFT == address(0)) {
            eligibilityNFT = address(this);
        } else {
            if (externalNFT.code.length == 0 || !IERC721(externalNFT).supportsInterface(type(IERC721).interfaceId)) {
                revert InvalidNFTCollection();
            }
            eligibilityNFT = externalNFT;
        }
        _grantRole(MINTER_ROLE, admin);
        _grantRole(BLOB_SUBMITTER_ROLE, admin);
        emit EligibilityConfigured(eligibilityNFT);
        emit ScheduleConfigured(opensAt, initialWindow, firstTallyAt, maxWindows, registrationDeadline, hardDeadline);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    /// @notice Update future dates without automatically moving any other tier.
    /// @dev Opening cannot change after it starts. Funded tiers cannot move after
    ///      their first tally; unfunded dates can be replaced with future dates.
    ///      Window parameters remain fixed and the constructor's overlap checks apply.
    function setDates(uint64 opensAt_, uint64[3] calldata firstTallyAt_) external onlyRole(ADMIN_ROLE) {
        if (opensAt_ != opensAt) {
            if (block.timestamp >= opensAt) revert DateAlreadyStarted();
            if (opensAt_ <= block.timestamp) revert InvalidSchedule();
        }
        for (uint256 tier; tier < 3; ++tier) {
            if (firstTallyAt_[tier] != firstTallyAt[tier]) {
                if (poolInitialized && block.timestamp >= firstTallyAt[tier]) revert DateAlreadyStarted();
                if (firstTallyAt_[tier] <= block.timestamp) revert InvalidSchedule();
            }
        }
        _validateSchedule(Schedule(opensAt_, initialWindow, firstTallyAt_, maxWindows));
        opensAt = opensAt_;
        firstTallyAt = firstTallyAt_;
        registrationDeadline = uint64(uint256(firstTallyAt_[0]) + initialWindow);
        hardDeadline = uint64(uint256(firstTallyAt_[2]) + maximumTierDuration);
        emit ScheduleConfigured(opensAt, initialWindow, firstTallyAt, maxWindows, registrationDeadline, hardDeadline);
    }

    function mint(address to, uint256 tokenId) external onlyRole(MINTER_ROLE) {
        if (eligibilityNFT != address(this)) revert ExternalCollection();
        if (poolInitialized && block.timestamp >= registrationDeadline) revert RegistrationClosed();
        _safeMint(to, tokenId);
    }

    function setBaseURI(string calldata baseURI) external onlyRole(ADMIN_ROLE) {
        _requireSetup();
        _metadataBaseURI = baseURI;
        emit MetadataBaseURISet(baseURI);
    }

    function _baseURI() internal view override returns (string memory) {
        return _metadataBaseURI;
    }

    function projectCount() public view returns (uint256) {
        return initiativeCount();
    }

    function voterOwner(uint256 tokenId) public view returns (address) {
        return IERC721(eligibilityNFT).ownerOf(tokenId);
    }

    /// @notice One-based window index. The initial window counts as window 1.
    function windowDuration(uint8 window) public view returns (uint64) {
        if (window == 0 || window > maxWindows) revert InvalidSchedule();
        return initialWindow >> (window - 1);
    }

    /// @notice Candidate cutoff if all preceding windows changed. Dates are
    ///         explicitly configured; early settlement requires replay.
    function windowCutoff(uint8 tier, uint8 window) external view returns (uint64) {
        if (tier >= 3 || window == 0 || window > maxWindows) revert InvalidSchedule();
        uint256 cutoff = firstTallyAt[tier];
        for (uint8 k = 1; k <= window; ++k) {
            cutoff += windowDuration(k);
        }
        return uint64(cutoff);
    }

    function latestSettlementAt(uint8 tier) external view returns (uint64) {
        if (tier >= 3) revert InvalidSchedule();
        return firstTallyAt[tier] + maximumTierDuration;
    }

    function record(Vote[] calldata votes) external {
        _open(votes.length);
        for (uint256 i; i < votes.length; ++i) {
            Vote calldata v = votes[i];
            _validateBallot(v.ballot);
            address voter = voterOwner(v.tokenId);
            bytes32 ballotHash = keccak256(v.ballot);
            (address signer, ECDSA.RecoverError err,) =
                ECDSA.tryRecover(_voteDigest(v.tokenId, voter, v.nonce, ballotHash), v.r, v.vs);
            if (err != ECDSA.RecoverError.NoError || signer != voter) revert InvalidSignature();
            _append(v.tokenId, voter, v.nonce, ballotHash, bytes32(0));
            emit BallotRecorded(v.tokenId, voter, v.nonce, v.ballot);
        }
    }

    function vote(uint256 tokenId, uint64 nonce, bytes calldata ballot) external {
        _open(1);
        address voter = voterOwner(tokenId);
        if (msg.sender != voter) revert NotNFTOwner(tokenId);
        _validateBallot(ballot);
        _append(tokenId, voter, nonce, keccak256(ballot), bytes32(0));
        emit BallotRecorded(tokenId, voter, nonce, ballot);
    }

    /// @notice Relayed signatures from the current NFT owner, including ERC-1271 wallets.
    function recordFor(uint256 tokenId, uint64 nonce, bytes calldata ballot, bytes calldata signature) external {
        _open(1);
        _validateBallot(ballot);
        address voter = voterOwner(tokenId);
        if (!SignatureChecker.isValidSignatureNow(
                voter, _voteDigest(tokenId, voter, nonce, keccak256(ballot)), signature
            )) {
            revert InvalidSignature();
        }
        _append(tokenId, voter, nonce, keccak256(ballot), bytes32(0));
        emit BallotRecorded(tokenId, voter, nonce, ballot);
    }

    /// @notice Hash-only receipts. Only authorized submitters may attach the blob
    ///         because bad/missing bytes can consume an NFT's signed nonce.
    function recordBlob(uint256 blobIndex, BlobVote[] calldata votes) external onlyRole(BLOB_SUBMITTER_ROLE) {
        _open(votes.length);
        bytes32 blobHash = blobhash(blobIndex);
        if (blobHash == bytes32(0)) revert NoBlob();
        for (uint256 i; i < votes.length; ++i) {
            BlobVote calldata v = votes[i];
            address voter = voterOwner(v.tokenId);
            (address signer, ECDSA.RecoverError err,) =
                ECDSA.tryRecover(_voteDigest(v.tokenId, voter, v.nonce, v.ballotHash), v.r, v.vs);
            if (err != ECDSA.RecoverError.NoError || signer != voter) revert InvalidSignature();
            _append(v.tokenId, voter, v.nonce, v.ballotHash, blobHash);
            emit BlobBallotRecorded(v.tokenId, voter, v.nonce, v.ballotHash, blobHash);
        }
    }

    /// @notice Digest binds the NFT ID, its current owner, nonce and ballot to
    ///         this chain and registry. Transferring the NFT invalidates signatures
    ///         from a previous owner; the NFT nonce and its one voting unit persist.
    function digestOf(uint256 tokenId, uint64 nonce, bytes32 ballotHash) external view returns (bytes32) {
        return _voteDigest(tokenId, voterOwner(tokenId), nonce, ballotHash);
    }

    function _voteDigest(uint256 tokenId, address voter, uint64 nonce, bytes32 ballotHash)
        private
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(VOTE_TYPEHASH, tokenId, voter, nonce, ballotHash)));
    }

    function _append(uint256 tokenId, address voter, uint64 nonce, bytes32 ballotHash, bytes32 blobHash) private {
        if (nonce <= nonceOf[tokenId]) revert StaleNonce(tokenId, nonce);
        if (!hasRegistrationReceipt[tokenId]) {
            if (poolInitialized && block.timestamp >= registrationDeadline) revert NotRegistered(tokenId);
            hasRegistrationReceipt[tokenId] = true;
            ++registrationReceiptCount;
            emit RegistrationReceipt(tokenId);
        }
        nonceOf[tokenId] = nonce;
        ballotHashOf[tokenId] = ballotHash;
        transcript = keccak256(abi.encode(transcript, tokenId, voter, nonce, ballotHash, blobHash));
        ++recordCount;
    }

    function _validateBallot(bytes calldata ballot) private view {
        uint256 m = projectCount();
        if (ballot.length != m) revert WrongLength();
        uint256[] memory counts = new uint256[](m + 1);
        for (uint256 i; i < m; ++i) {
            uint8 rank = uint8(ballot[i]);
            if (rank == 255) continue;
            // The default is explicit withholding, not implicit tail approval.
            if (rank == 0 || rank > m) revert InvalidBallot();
            ++counts[rank];
        }
        uint256 seen;
        for (uint256 rank = 1; rank <= m; ++rank) {
            if (counts[rank] != 0 && rank != seen + 1) revert InvalidBallot();
            seen += counts[rank];
        }
    }

    function _open(uint256 count) private view {
        if (block.timestamp < opensAt) revert VotingNotStarted();
        if (poolInitialized && block.timestamp >= hardDeadline) revert VotingClosed();
        if (count == 0) revert NoVotes();
        if (projectCount() == 0) revert NoProjects();
    }

    function _requireSetup() internal view override {
        if (block.timestamp >= opensAt) revert ConfigurationFrozen();
    }

    function _requireAccountingOpen() internal view override {
        if (poolInitialized && block.timestamp >= hardDeadline) revert VotingClosed();
    }

    function _requireInitialFundingOpen() internal view override {
        if (block.timestamp >= firstTallyAt[0]) revert InitialFundingTooLate();
    }

    function _validateSchedule(Schedule memory s) private pure returns (uint256 duration) {
        if (s.initialWindow == 0 || s.maxWindows == 0 || s.maxWindows > 64) {
            revert InvalidSchedule();
        }
        for (uint8 k; k < s.maxWindows; ++k) {
            uint64 length = s.initialWindow >> k;
            if (length == 0) revert InvalidSchedule();
            duration += length;
        }
        if (
            s.firstTallyAt[0] < s.opensAt || uint256(s.firstTallyAt[0]) + duration > s.firstTallyAt[1]
                || uint256(s.firstTallyAt[1]) + duration > s.firstTallyAt[2]
                || uint256(s.firstTallyAt[2]) + duration > type(uint64).max
        ) revert InvalidSchedule();
    }
}
