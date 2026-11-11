// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
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
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant PLEDGE_ROLE = keccak256("PLEDGE_ROLE");

    error InvalidAddress();
    error UnknownCurrency();
    error DuplicateCurrency();
    error TooManyCurrencies();
    error InvalidCurrency();
    error InvalidPrice(uint256 currencyId);
    error StalePrice(uint256 currencyId);
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
        uint32 maxPriceAge;
    }

    /// @dev `groups` is a bitmask over the registered groups (affiliations): two projects are
    ///      related when their masks overlap. RFPs belong to no group.
    struct Initiative {
        address account;
        bool rfp;
        uint256 askUsd; // Six decimal places.
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

    event CurrencyRegistered(
        uint256 indexed currencyId,
        address indexed asset,
        address usdFeed,
        uint8 amountDecimals,
        uint8 feedDecimals,
        uint32 maxPriceAge
    );
    event InitiativeConfigured(
        uint256 indexed initiativeId, address indexed account, uint256 askUsd, bool rfp, uint256 groups
    );
    event GroupAdded(uint8 indexed id, bytes32 name);
    event PoolUsdSet(uint256 previousAmountUsd, uint256 amountUsd);
    event PledgeSet(bytes32 indexed pledgeId, uint256 indexed initiativeId, uint256 indexed currencyId, uint256 amount);

    constructor(address admin) {
        if (admin == address(0)) revert InvalidAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(PLEDGE_ROLE, admin);
        // A dollar accounting unit for USD asks and pledges. It
        // does not represent a stablecoin and never reads a wallet balance.
        _currencies.push(Currency(address(0), address(0), 6, 6, 0));
        emit CurrencyRegistered(USD, address(0), address(0), 6, 6, 0);
    }

    function currencyCount() public view returns (uint256) {
        return _currencies.length;
    }

    function currency(uint256 id) public view returns (Currency memory) {
        _requireCurrency(id);
        return _currencies[id];
    }

    /// @notice Register a native/ERC-20 currency and its USD pricing rule.
    /// @dev A zero feed AND zero maxPriceAge explicitly select fixed $1 pricing
    ///      for an ERC-20. Native currency requires a feed. Definitions freeze at opening.
    function registerCurrency(address asset, address usdFeed, uint32 maxPriceAge)
        external
        onlyRole(ADMIN_ROLE)
        returns (uint256 id)
    {
        _requireSetup();
        if (_currencies.length == MAX_CURRENCIES) revert TooManyCurrencies();
        if (_assetRegistered[asset]) revert DuplicateCurrency();
        if (asset != address(0) && asset.code.length == 0) revert InvalidCurrency();
        uint8 amountDecimals = asset == address(0) ? 18 : IERC20Metadata(asset).decimals();
        uint8 feedDecimals;
        if (usdFeed == address(0)) {
            if (asset == address(0) || maxPriceAge != 0) revert InvalidCurrency();
        } else {
            if (usdFeed.code.length == 0 || maxPriceAge == 0) revert InvalidCurrency();
            feedDecimals = IPriceFeed(usdFeed).decimals();
        }
        if (amountDecimals > 18 || feedDecimals > 18) revert InvalidCurrency();
        id = _currencies.length;
        _currencies.push(Currency(asset, usdFeed, amountDecimals, feedDecimals, maxPriceAge));
        _assetRegistered[asset] = true;
        emit CurrencyRegistered(id, asset, usdFeed, amountDecimals, feedDecimals, maxPriceAge);
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
    function addInitiative(address account, uint256 askUsd, bool rfp, uint256 groups)
        external
        onlyRole(ADMIN_ROLE)
        returns (uint256 id)
    {
        _requireAdding();
        if (_initiatives.length == MAX_PROJECTS) revert TooManyInitiatives();
        _checkInitiativeAccount(account);
        _checkGroups(rfp, groups);
        id = _initiatives.length;
        _initiatives.push(Initiative(account, rfp, askUsd, groups));
        _initiativeRegistered[account] = true;
        emit InitiativeConfigured(id, account, askUsd, rfp, groups);
    }

    function setInitiative(uint256 id, address account, uint256 askUsd, bool rfp, uint256 groups)
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
        _initiatives[id] = Initiative(account, rfp, askUsd, groups);
        emit InitiativeConfigured(id, account, askUsd, rfp, groups);
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
        return _convert(amount, _price(currencyId, c), c);
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
            donated = c.asset == address(0) ? account.balance : IERC20Metadata(c.asset).balanceOf(account);
        }
        pledged = pledgedAmount[initiativeId][currencyId];
    }

    /// @notice USD support at the current block: actual initiative balances plus
    ///         outstanding admin-recorded pledges, then the remaining dollar ask.
    /// @dev Use an archive RPC block tag to evaluate this view at a historical
    ///      checkpoint. Supplying an old oracle price alone would NOT recover old
    ///      wallet balances or pledge state. Stale/unavailable nonzero prices revert.
    function initiativeUsd(uint256 initiativeId)
        public
        view
        returns (uint256 donatedUsd, uint256 pledgedUsd, uint256 totalUsd, uint256 remainingAskUsd)
    {
        _requireInitiative(initiativeId);
        for (uint256 i; i < _currencies.length; ++i) {
            (uint256 donated, uint256 pledged) = initiativeCurrencyAmounts(initiativeId, i);
            if (i == USD) {
                pledgedUsd += pledged;
            } else if (donated != 0 || pledged != 0) {
                Currency memory c = _currencies[i];
                uint256 price = _price(i, c);
                donatedUsd += _convert(donated, price, c);
                pledgedUsd += _convert(pledged, price, c);
            }
        }
        totalUsd = donatedUsd + pledgedUsd;
        uint256 ask = _initiatives[initiativeId].askUsd;
        remainingAskUsd = totalUsd >= ask ? 0 : ask - totalUsd;
    }

    function _price(uint256 id, Currency memory c) private view returns (uint256) {
        if (c.asset != address(0) && IERC20Metadata(c.asset).decimals() != c.amountDecimals) {
            revert InvalidCurrency();
        }
        // Fixed-dollar ERC-20s still use their registered token decimals. With
        // feedDecimals == 0, a price of 1 converts one whole token to USD_SCALE.
        if (c.usdFeed == address(0)) return 1;
        IPriceFeed feed = IPriceFeed(c.usdFeed);
        if (feed.decimals() != c.feedDecimals) revert InvalidPrice(id);
        (uint80 round, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();
        if (round == 0 || answer <= 0 || updatedAt == 0 || updatedAt > block.timestamp) revert InvalidPrice(id);
        if (block.timestamp - updatedAt > c.maxPriceAge) revert StalePrice(id);
        uint256 price = uint256(answer);
        if (price > type(uint256).max / USD_SCALE) revert InvalidPrice(id);
        return price;
    }

    function _convert(uint256 amount, uint256 price, Currency memory c) private pure returns (uint256) {
        return Math.mulDiv(amount, price * USD_SCALE, 10 ** (uint256(c.amountDecimals) + c.feedDecimals));
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

    /// @dev Ask and groups of project `id`, for ballot validation (two storage reads).
    function _askAndGroups(uint256 id) internal view returns (uint256 askUsd, uint256 groups) {
        Initiative storage x = _initiatives[id];
        return (x.askUsd, x.groups);
    }

    function _requireSetup() internal view virtual;
    function _requireAdding() internal view virtual;
    function _initialFundingOpen() internal view virtual returns (bool);
    function _requireInitialFundingOpen() internal view virtual;
    function _requireAccountingOpen() internal view virtual;
}
