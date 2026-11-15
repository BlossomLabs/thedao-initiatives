// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPriceFeed} from "./IPriceFeed.sol";

/// @notice Replayable funding records and live USD views. This contract does not
///         custody the pool, transfer funds, or decide which initiatives win.
abstract contract RoundAccounting is AccessControl {
    uint256 public constant USD = 0;
    uint256 public constant USD_SCALE = 1e6;
    uint256 public constant MAX_CURRENCIES = 32;
    uint256 public constant MAX_PROJECTS = 254;
    uint256 public constant MAX_GROUPS = 256;
    /// @dev Gas forwarded to each feed or token read, so a starving callee cannot block a view.
    uint256 internal constant EXTERNAL_READ_GAS = 50_000;
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant PLEDGE_ROLE = keccak256("PLEDGE_ROLE");

    error InvalidAddress();
    error UnknownCurrency();
    error DuplicateCurrency();
    error TooManyCurrencies();
    error InvalidCurrency();
    error InvalidPrice(uint256 currencyId);
    error UnknownInitiative();
    error DuplicateInitiative();
    error TooManyInitiatives();
    error InvalidPledgeId();
    error PoolCannotDecrease();
    error TooManyGroups();
    error UnknownGroup();
    error RfpWithGroups();

    struct Currency {
        address asset; // address(0) means native currency, except virtual currency USD.
        address usdFeed; // address(0) explicitly values an ERC-20 at one USD per token.
        uint8 amountDecimals;
        uint8 feedDecimals;
    }

    /// @dev The newest good feed answer a ballot has seen, kept as the fallback when a feed breaks.
    struct LastPrice {
        uint192 price;
        uint64 updatedAt;
    }

    /// @dev `groups` is a bitmask over the registered groups (affiliations): two projects are
    ///      related when their masks overlap. RFPs belong to no group.
    struct Initiative {
        address account;
        bool rfp;
        uint256 goalUsd; // Six decimal places.
        uint256 groups;
    }

    struct Pledge {
        uint256 initiativeId;
        uint256 currencyId;
        uint256 amount;
        bool exists;
    }

    Currency[] private _currencies;
    Initiative[] private _initiatives;
    bytes32[] private _groupNames;
    mapping(address asset => bool) private _assetRegistered;
    mapping(address account => bool) private _initiativeRegistered;
    /// @notice Admin-recorded budget in six-decimal USD. Correctable before S's
    ///         first tally; increase-only from then on.
    /// @dev This records a funding assertion, not custody or proof of conversion.
    uint256 public poolUsd;
    /// @notice Records whether the admin explicitly initialized funding before S.
    bool public poolInitialized;
    mapping(bytes32 pledgeId => Pledge) public pledges;
    mapping(uint256 initiativeId => mapping(uint256 currencyId => uint256 amount)) public pledgedAmount;
    /// @notice Per currency, the newest good price stored (registration or a ballot). No age limit.
    mapping(uint256 currencyId => LastPrice) public lastPrice;

    event CurrencyRegistered(
        uint256 indexed currencyId, address indexed asset, address usdFeed, uint8 amountDecimals, uint8 feedDecimals
    );
    event PriceStored(uint256 indexed currencyId, uint256 price, uint256 updatedAt);
    event InitiativeConfigured(
        uint256 indexed initiativeId, address indexed account, uint256 goalUsd, bool rfp, uint256 groups
    );
    event GroupAdded(uint8 indexed id, bytes32 name);
    event PoolUsdSet(uint256 previousAmountUsd, uint256 amountUsd);
    event PledgeSet(bytes32 indexed pledgeId, uint256 indexed initiativeId, uint256 indexed currencyId, uint256 amount);

    constructor(address admin) {
        if (admin == address(0)) revert InvalidAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(PLEDGE_ROLE, admin);
        // A dollar accounting unit for USD goals and pledges. It
        // does not represent a stablecoin and never reads a wallet balance.
        _currencies.push(Currency(address(0), address(0), 6, 6));
        emit CurrencyRegistered(USD, address(0), address(0), 6, 6);
    }

    function currencyCount() public view returns (uint256) {
        return _currencies.length;
    }

    function currency(uint256 id) public view returns (Currency memory) {
        _requireCurrency(id);
        return _currencies[id];
    }

    /// @notice Register a native/ERC-20 currency and its USD pricing rule.
    /// @dev A zero feed explicitly selects fixed $1 pricing for an ERC-20. Native
    ///      currency requires a feed, which must answer a good price now; that price
    ///      seeds `lastPrice`. Definitions freeze at opening.
    function registerCurrency(address asset, address usdFeed) external onlyRole(ADMIN_ROLE) returns (uint256 id) {
        _requireSetup();
        if (_currencies.length == MAX_CURRENCIES) revert TooManyCurrencies();
        if (_assetRegistered[asset]) revert DuplicateCurrency();
        if (asset != address(0) && asset.code.length == 0) revert InvalidCurrency();
        uint8 amountDecimals = asset == address(0) ? 18 : IERC20Metadata(asset).decimals();
        uint8 feedDecimals;
        if (usdFeed == address(0)) {
            if (asset == address(0)) revert InvalidCurrency();
        } else {
            if (usdFeed.code.length == 0) revert InvalidCurrency();
            feedDecimals = IPriceFeed(usdFeed).decimals();
        }
        if (amountDecimals > 18 || feedDecimals > 18) revert InvalidCurrency();
        id = _currencies.length;
        Currency memory c = Currency(asset, usdFeed, amountDecimals, feedDecimals);
        _currencies.push(c);
        _assetRegistered[asset] = true;
        emit CurrencyRegistered(id, asset, usdFeed, amountDecimals, feedDecimals);
        if (usdFeed != address(0)) {
            (uint256 price, uint64 updatedAt, bool good) = _readPrice(id, c);
            if (!good) revert InvalidPrice(id);
            _storePrice(id, price, updatedAt);
        }
    }

    function initiativeCount() public view returns (uint256) {
        return _initiatives.length;
    }

    function initiative(uint256 id) public view returns (Initiative memory) {
        _requireInitiative(id);
        return _initiatives[id];
    }

    function groupCount() public view returns (uint256) {
        return _groupNames.length;
    }

    function groupName(uint256 id) external view returns (bytes32) {
        if (id >= _groupNames.length) revert UnknownGroup();
        return _groupNames[id];
    }

    /// @notice A group of related projects (an affiliation). Allowed whenever projects may be added.
    function addGroup(bytes32 name) external onlyRole(ADMIN_ROLE) returns (uint8 id) {
        _requireAdding();
        if (_groupNames.length == MAX_GROUPS) revert TooManyGroups();
        id = uint8(_groupNames.length);
        _groupNames.push(name);
        emit GroupAdded(id, name);
    }

    /// @notice Before voting opens, or during the vote outside every tier's quiet-ending
    ///         span. Existing projects never change once voting opens, so an addition
    ///         cannot change whether an earlier ballot was valid.
    function addInitiative(address account, uint256 goalUsd, bool rfp, uint256 groups)
        external
        onlyRole(ADMIN_ROLE)
        returns (uint256 id)
    {
        _requireAdding();
        if (_initiatives.length == MAX_PROJECTS) revert TooManyInitiatives();
        _checkInitiativeAccount(account);
        _checkGroups(rfp, groups);
        id = _initiatives.length;
        _initiatives.push(Initiative(account, rfp, goalUsd, groups));
        _initiativeRegistered[account] = true;
        emit InitiativeConfigured(id, account, goalUsd, rfp, groups);
    }

    function setInitiative(uint256 id, address account, uint256 goalUsd, bool rfp, uint256 groups)
        external
        onlyRole(ADMIN_ROLE)
    {
        _requireSetup();
        _requireInitiative(id);
        _checkGroups(rfp, groups);
        address previous = _initiatives[id].account;
        if (account != previous) {
            _checkInitiativeAccount(account);
            _initiativeRegistered[previous] = false;
            _initiativeRegistered[account] = true;
        }
        _initiatives[id] = Initiative(account, rfp, goalUsd, groups);
        emit InitiativeConfigured(id, account, goalUsd, rfp, groups);
    }

    /// @notice Initialize, correct or increase net USD funding while the round is open.
    /// @dev Initial funding, including an explicit zero, must precede S's first
    ///      tally. Before that tally no award is committed, so a mistyped total may
    ///      be lowered; afterwards the total only increases. Funding never changes
    ///      dates. No conversion occurs.
    function setPoolUsd(uint256 amountUsd) external onlyRole(ADMIN_ROLE) {
        _requireAccountingOpen();
        uint256 previous = poolUsd;
        if (amountUsd < previous && !_initialFundingOpen()) revert PoolCannotDecrease();
        poolUsd = amountUsd;
        if (!poolInitialized) {
            _requireInitialFundingOpen();
            poolInitialized = true;
        }
        emit PoolUsdSet(previous, amountUsd);
    }

    /// @notice Upsert a pledge by its unique ID. Setting amount to zero cancels it;
    ///         changing its initiative/currency removes the old aggregate first.
    /// @dev When a pledge becomes an on-chain donation the admin must reduce or
    ///      cancel it, otherwise the two sources would be double counted.
    function setPledge(bytes32 pledgeId, uint256 initiativeId, uint256 currencyId, uint256 amount)
        external
        onlyRole(PLEDGE_ROLE)
    {
        _setPledge(pledgeId, initiativeId, currencyId, amount);
    }

    function _setPledge(bytes32 pledgeId, uint256 initiativeId, uint256 currencyId, uint256 amount) internal {
        _requireAccountingOpen();
        if (pledgeId == bytes32(0)) revert InvalidPledgeId();
        _requireInitiative(initiativeId);
        _requireCurrency(currencyId);
        Pledge memory previous = pledges[pledgeId];
        if (previous.exists) {
            pledgedAmount[previous.initiativeId][previous.currencyId] -= previous.amount;
        }
        pledgedAmount[initiativeId][currencyId] += amount;
        pledges[pledgeId] = Pledge(initiativeId, currencyId, amount, true);
        emit PledgeSet(pledgeId, initiativeId, currencyId, amount);
    }

    /// @notice Convert an amount to USD with six decimals, rounding down.
    function quoteUsd(uint256 currencyId, uint256 amount) public view returns (uint256) {
        _requireCurrency(currencyId);
        if (currencyId == USD) return amount;
        if (amount == 0) return 0;
        Currency memory c = _currencies[currencyId];
        (uint256 price,,) = _readPrice(currencyId, c);
        return _convert(amount, price, c);
    }

    function initiativeCurrencyAmounts(uint256 initiativeId, uint256 currencyId)
        public
        view
        returns (uint256 donated, uint256 pledged)
    {
        _requireInitiative(initiativeId);
        _requireCurrency(currencyId);
        Currency memory c = _currencies[currencyId];
        address account = _initiatives[initiativeId].account;
        if (currencyId != USD) {
            donated = c.asset == address(0) ? account.balance : _tokenBalance(c.asset, account);
        }
        pledged = pledgedAmount[initiativeId][currencyId];
    }

    /// @notice USD support at the current block: actual initiative balances plus
    ///         outstanding admin-recorded pledges, then the ask: the dollar goal less
    ///         that support, never below zero.
    /// @dev Use an archive RPC block tag to evaluate this view at a historical
    ///      checkpoint. Supplying an old oracle price alone would NOT recover old
    ///      wallet balances or pledge state. A price never reverts: a feed that is not
    ///      good falls back to `lastPrice`; a token whose `balanceOf` reverts counts as zero.
    function initiativeUsd(uint256 initiativeId)
        public
        view
        returns (uint256 donatedUsd, uint256 pledgedUsd, uint256 totalUsd, uint256 askUsd)
    {
        _requireInitiative(initiativeId);
        uint256 n = _currencies.length;
        Currency[] memory cs = new Currency[](n);
        uint256[] memory prices = new uint256[](n);
        for (uint256 i = 1; i < n; ++i) {
            cs[i] = _currencies[i];
            (prices[i],,) = _readPrice(i, cs[i]);
        }
        (donatedUsd, pledgedUsd) = _supportOf(initiativeId, cs, prices);
        totalUsd = Math.saturatingAdd(donatedUsd, pledgedUsd);
        uint256 goal = _initiatives[initiativeId].goalUsd;
        askUsd = totalUsd >= goal ? 0 : goal - totalUsd;
    }

    /// @notice The price `quoteUsd` and `initiativeUsd` use for a currency: the feed's answer
    ///         when good, else the last good price stored.
    function priceUsd(uint256 currencyId) external view returns (uint256 price) {
        _requireCurrency(currencyId);
        (price,,) = _readPrice(currencyId, _currencies[currencyId]);
    }

    /// @dev A feed answer is good when the call succeeds, `roundId != 0`, `answer > 0`,
    ///      `updatedAt` is nonzero and not in the future, and `decimals()` equals the registered
    ///      feedDecimals (answers above uint192 are also refused). Age never matters. Not good
    ///      returns the stored last price. A zero feed is the fixed price 1: with
    ///      feedDecimals == 0 one whole token converts to USD_SCALE.
    function _readPrice(uint256 id, Currency memory c)
        internal
        view
        returns (uint256 price, uint64 updatedAt, bool good)
    {
        if (c.usdFeed == address(0)) return (1, 0, true);
        (bool ok, bytes memory data) = _boundedRead(c.usdFeed, abi.encodeCall(IPriceFeed.decimals, ()), 32);
        if (ok && abi.decode(data, (uint256)) == c.feedDecimals) {
            (ok, data) = _boundedRead(c.usdFeed, abi.encodeCall(IPriceFeed.latestRoundData, ()), 160);
            if (ok) {
                (uint256 round, int256 answer,, uint256 at,) =
                    abi.decode(data, (uint256, int256, uint256, uint256, uint256));
                if (
                    round != 0 && round <= type(uint80).max && answer > 0 && uint256(answer) <= type(uint192).max
                        && at != 0 && at <= block.timestamp && at <= type(uint64).max
                ) {
                    return (uint256(answer), uint64(at), true);
                }
            }
        }
        LastPrice memory last = lastPrice[id];
        return (last.price, last.updatedAt, false);
    }

    /// @dev Keep a good price only when it is newer than the one stored.
    function _storePrice(uint256 id, uint256 price, uint64 updatedAt) internal {
        if (updatedAt <= lastPrice[id].updatedAt) return;
        lastPrice[id] = LastPrice(uint192(price), updatedAt);
        emit PriceStored(id, price, updatedAt);
    }

    /// @dev Raw read: any failure (revert, no code, short data, gas use over the cap) counts as zero.
    function _tokenBalance(address token, address account) internal view returns (uint256) {
        (bool ok, bytes memory data) = _boundedRead(token, abi.encodeCall(IERC20.balanceOf, (account)), 32);
        return ok ? abi.decode(data, (uint256)) : 0;
    }

    /// @dev One external read with `EXTERNAL_READ_GAS` and a fixed `outLen`-byte output area:
    ///      at most `outLen` bytes of the callee's return (or revert) data are ever copied into
    ///      memory, so a callee returning a huge blob cannot grow memory cost across a ballot's
    ///      reads. A revert, no code, or fewer than `outLen` bytes returned is `ok == false`.
    function _boundedRead(address target, bytes memory callData, uint256 outLen)
        private
        view
        returns (bool ok, bytes memory out)
    {
        out = new bytes(outLen);
        uint256 gas_ = EXTERNAL_READ_GAS;
        assembly ("memory-safe") {
            ok := staticcall(gas_, target, add(callData, 32), mload(callData), add(out, 32), outLen)
            if lt(returndatasize(), outLen) { ok := 0 }
        }
    }

    /// @dev Each placed project's ask at this block: its dollar goal less donations and open
    ///      pledges, never below zero. A project at rank 255 (unplaced) is not read and stays 0.
    ///      The caller checks the length and passes the prices from `_pricesNow`.
    function _asksOf(bytes calldata ballot, Currency[] memory cs, uint256[] memory prices)
        internal
        view
        returns (uint256[] memory asks)
    {
        asks = new uint256[](ballot.length);
        for (uint256 p; p < ballot.length; ++p) {
            if (uint8(ballot[p]) == 255) continue;
            // Written out here, not through `_askOf`: this loop is the hot path of every ballot.
            (uint256 donatedUsd, uint256 pledgedUsd) = _supportOf(p, cs, prices);
            uint256 support = Math.saturatingAdd(donatedUsd, pledgedUsd);
            uint256 goal = _initiatives[p].goalUsd;
            asks[p] = support >= goal ? 0 : goal - support;
        }
    }

    /// @dev Whether every project the ballot leaves out (rank 255, or past its end) asks $0.
    ///      Stops at the first one that asks anything.
    function _unplacedAskNothing(bytes calldata ballot, Currency[] memory cs, uint256[] memory prices)
        internal
        view
        returns (bool)
    {
        for (uint256 p; p < _initiatives.length; ++p) {
            if (p < ballot.length && uint8(ballot[p]) != 255) continue;
            if (_askOf(p, cs, prices) != 0) return false;
        }
        return true;
    }

    /// @dev One project's ask: goal less donations and open pledges, never below zero.
    function _askOf(uint256 p, Currency[] memory cs, uint256[] memory prices) private view returns (uint256) {
        (uint256 donatedUsd, uint256 pledgedUsd) = _supportOf(p, cs, prices);
        uint256 support = Math.saturatingAdd(donatedUsd, pledgedUsd);
        uint256 goal = _initiatives[p].goalUsd;
        return support >= goal ? 0 : goal - support;
    }

    /// @dev Every currency's price, read once per ballot; a good answer is kept through
    ///      `_storePrice`, which writes only when it is newer. Index 0 (USD) is left empty.
    function _pricesNow() internal returns (Currency[] memory cs, uint256[] memory prices) {
        uint256 n = _currencies.length;
        cs = new Currency[](n);
        prices = new uint256[](n);
        for (uint256 i = 1; i < n; ++i) {
            cs[i] = _currencies[i];
            (uint256 price, uint64 updatedAt, bool good) = _readPrice(i, cs[i]);
            prices[i] = price;
            if (good && cs[i].usdFeed != address(0)) _storePrice(i, price, updatedAt);
        }
    }

    /// @dev The one support computation, for `_askOf` and `initiativeUsd`: USD of one project's
    ///      balances and of its open pledges at the given prices (index 0 is the USD unit).
    ///      Each part converts and rounds down on its own, and sums saturate, so no
    ///      balance read can make it revert.
    function _supportOf(uint256 p, Currency[] memory cs, uint256[] memory prices)
        internal
        view
        returns (uint256 donatedUsd, uint256 pledgedUsd)
    {
        address account = _initiatives[p].account;
        pledgedUsd = pledgedAmount[p][USD];
        for (uint256 i = 1; i < cs.length; ++i) {
            Currency memory c = cs[i];
            uint256 donated = c.asset == address(0) ? account.balance : _tokenBalance(c.asset, account);
            donatedUsd = Math.saturatingAdd(donatedUsd, _convert(donated, prices[i], c));
            pledgedUsd = Math.saturatingAdd(pledgedUsd, _convert(pledgedAmount[p][i], prices[i], c));
        }
    }

    /// @dev Rounds down; a result that does not fit in 256 bits saturates instead of reverting.
    function _convert(uint256 amount, uint256 price, Currency memory c) private pure returns (uint256) {
        if (amount == 0) return 0;
        uint256 scaled = price * USD_SCALE;
        uint256 denominator = 10 ** (uint256(c.amountDecimals) + c.feedDecimals);
        (uint256 high,) = Math.mul512(amount, scaled);
        if (high >= denominator) return type(uint256).max;
        return Math.mulDiv(amount, scaled, denominator);
    }

    function _requireCurrency(uint256 id) private view {
        if (id >= _currencies.length) revert UnknownCurrency();
    }

    function _requireInitiative(uint256 id) private view {
        if (id >= _initiatives.length) revert UnknownInitiative();
    }

    function _checkInitiativeAccount(address account) private view {
        if (account == address(0) || account == address(this)) revert InvalidAddress();
        if (_initiativeRegistered[account]) revert DuplicateInitiative();
    }

    function _checkGroups(bool rfp, uint256 groups) private view {
        if (rfp && groups != 0) revert RfpWithGroups();
        uint256 n = _groupNames.length;
        if (n < MAX_GROUPS && groups >> n != 0) revert UnknownGroup();
    }

    /// @dev Goal and groups of project `id`, for ballot validation (two storage reads).
    function _goalAndGroups(uint256 id) internal view returns (uint256 goalUsd, uint256 groups) {
        Initiative storage x = _initiatives[id];
        return (x.goalUsd, x.groups);
    }

    function _requireSetup() internal view virtual;
    function _requireAdding() internal view virtual;
    function _initialFundingOpen() internal view virtual returns (bool);
    function _requireInitialFundingOpen() internal view virtual;
    function _requireAccountingOpen() internal view virtual;
}
