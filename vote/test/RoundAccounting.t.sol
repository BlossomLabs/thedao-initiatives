// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Fixture, MockToken, MockFeed} from "./helpers/Fixtures.sol";
import {SignedBallots} from "../contracts/SignedBallots.sol";
import {RoundAccounting} from "../contracts/RoundAccounting.sol";

contract RoundAccountingTest is Fixture {
    event PoolUsdSet(uint256 previousAmountUsd, uint256 amountUsd);

    MockFeed internal ethFeed;
    MockFeed internal usdcFeed;
    MockToken internal usdc;
    uint256 internal eth;
    uint256 internal dollarToken;

    function setUp() public override {
        super.setUp();
        ethFeed = new MockFeed(8, 2_000e8);
        usdcFeed = new MockFeed(8, 1e8);
        usdc = new MockToken(6);
        eth = ballots.registerCurrency(address(0), address(ethFeed), 3600);
        dollarToken = ballots.registerCurrency(address(usdc), address(usdcFeed), 3600);
    }

    function test_mixedDonationsAndPledgesProduceNetAsk() public {
        vm.deal(INITIATIVE_A, 2 ether); // $4,000.
        usdc.mint(INITIATIVE_A, 1_000e6);
        ballots.setPledge(keccak256("eth pledge"), 0, eth, 3 ether); // $6,000.
        ballots.setPledge(keccak256("dollar pledge"), 0, ballots.USD(), 500e6);
        (uint256 donated, uint256 pledged, uint256 total, uint256 ask) = ballots.initiativeUsd(0);
        assertEq(donated, 5_000e6);
        assertEq(pledged, 6_500e6);
        assertEq(total, 11_500e6);
        assertEq(ask, 8_500e6);
        (uint256 nativeDonations, uint256 nativePledges) = ballots.initiativeCurrencyAmounts(0, eth);
        assertEq(nativeDonations, 2 ether);
        assertEq(nativePledges, 3 ether);
    }

    function test_poolIsSeparateFromSupportAndDoesNotDependOnPrices() public {
        ballots.setPoolUsd(810_000e6);
        assertEq(ballots.poolUsd(), 810_000e6);
        vm.deal(INITIATIVE_A, 50 ether);
        usdc.mint(INITIATIVE_A, 10_000e6);
        ballots.setPledge(keccak256("pledge"), 0, eth, 1 ether);
        assertEq(ballots.poolUsd(), 810_000e6); // Initiative support is not pool funding.
        ethFeed.set(1_000e8, block.timestamp);
        usdcFeed.set(80_000_000, block.timestamp);
        assertEq(ballots.poolUsd(), 810_000e6);
        ethFeed.setUnavailable(true);
        usdcFeed.setUnavailable(true);
        vm.warp(ballots.firstTallyAt(0));
        assertEq(ballots.poolUsd(), 810_000e6);
        vm.warp(ballots.hardDeadline());
        assertEq(ballots.poolUsd(), 810_000e6);
    }

    function test_poolIncreasesPreserveEventHistoryAndNeverDecrease() public {
        vm.expectEmit(false, false, false, true, address(ballots));
        emit PoolUsdSet(0, 810_000e6);
        ballots.setPoolUsd(810_000e6);
        vm.warp(start);
        vm.expectEmit(false, false, false, true, address(ballots));
        emit PoolUsdSet(810_000e6, 900_000e6);
        ballots.setPoolUsd(900_000e6);
        vm.expectRevert(RoundAccounting.PoolCannotDecrease.selector);
        ballots.setPoolUsd(810_000e6);
        vm.expectRevert(RoundAccounting.PoolCannotDecrease.selector);
        ballots.setPoolUsd(0);
        assertEq(ballots.poolUsd(), 900_000e6);
        vm.warp(ballots.firstTallyAt(0) - 1);
        ballots.setPoolUsd(900_000e6 + 123_456);
        assertEq(ballots.poolUsd(), 900_000e6 + 123_456);
    }

    function test_poolIncreasesAfterFirstTallyWithoutRestartingTheSchedule() public {
        uint256 firstTally = ballots.firstTallyAt(0);
        uint256 registrationEnd = ballots.registrationDeadline();
        uint256 hardEnd = ballots.hardDeadline();
        vm.warp(firstTally - 1);
        ballots.setPoolUsd(800_000e6);
        vm.warp(firstTally);
        ballots.setPoolUsd(900_000e6);
        vm.expectRevert(RoundAccounting.PoolCannotDecrease.selector);
        ballots.setPoolUsd(0);
        assertEq(ballots.poolUsd(), 900_000e6);

        // Registration is still open; the final NFT count is a replay input.
        assertLt(firstTally, ballots.registrationDeadline());
        ballots.mint(bob, 99);
        ballots.setPledge(keccak256("during S window"), 0, ballots.USD(), 100e6);
        assertEq(ballots.pledgedAmount(0, ballots.USD()), 100e6);
        vm.warp(registrationEnd + 1);
        ballots.setPoolUsd(1_000_000e6);
        ballots.setPoolUsd(1_000_000e6); // An unchanged total adds no funding.
        assertEq(ballots.firstTallyAt(0), firstTally);
        assertEq(ballots.registrationDeadline(), registrationEnd);
        assertEq(ballots.hardDeadline(), hardEnd);
        assertEq(ballots.poolUsd(), 1_000_000e6);
    }

    function test_pledgeUpsertDoesNotDoubleCountAndCanChangeCurrencyOrInitiative() public {
        bytes32 id = keccak256("one pledge");
        ballots.setPledge(id, 0, eth, 3 ether);
        ballots.setPledge(id, 0, eth, 2 ether);
        assertEq(ballots.pledgedAmount(0, eth), 2 ether);
        ballots.setPledge(id, 1, dollarToken, 50e6);
        assertEq(ballots.pledgedAmount(0, eth), 0);
        assertEq(ballots.pledgedAmount(1, dollarToken), 50e6);
        ballots.setPledge(id, 1, dollarToken, 0);
        (, uint256 pledged,,) = ballots.initiativeUsd(1);
        assertEq(pledged, 0);
    }

    function test_pledgeFulfilmentCanBeRecordedWithoutDoubleCounting() public {
        bytes32 id = keccak256("fulfilled");
        ballots.setPledge(id, 0, dollarToken, 100e6);
        usdc.mint(INITIATIVE_A, 100e6);
        ballots.setPledge(id, 0, dollarToken, 0);
        (uint256 donated, uint256 pledged, uint256 total,) = ballots.initiativeUsd(0);
        assertEq(donated, 100e6);
        assertEq(pledged, 0);
        assertEq(total, 100e6);
    }

    function test_liveDonationWithdrawalsAndPriceFallsChangeAsk() public {
        vm.deal(INITIATIVE_A, 2 ether);
        usdc.mint(INITIATIVE_A, 1_000e6);
        (,, uint256 total, uint256 ask) = ballots.initiativeUsd(0);
        assertEq(total, 5_000e6);
        assertEq(ask, 15_000e6);
        ethFeed.set(1_000e8, block.timestamp);
        vm.prank(INITIATIVE_A);
        usdc.transfer(bob, 500e6);
        (,, total, ask) = ballots.initiativeUsd(0);
        assertEq(total, 2_500e6);
        assertEq(ask, 17_500e6);
    }

    function test_supportAboveAskFloorsRemainingAskAtZero() public {
        ballots.setPledge(keccak256("large"), 0, ballots.USD(), 100_000e6);
        (,, uint256 total, uint256 ask) = ballots.initiativeUsd(0);
        assertEq(total, 100_000e6);
        assertEq(ask, 0);
    }

    function test_stablecoinUsesItsFeedAndCanDepeg() public {
        usdc.mint(INITIATIVE_A, 1_000e6);
        usdcFeed.set(80_000_000, block.timestamp);
        (uint256 donated,,,) = ballots.initiativeUsd(0);
        assertEq(donated, 800e6);
    }

    function test_fixedUsdTokenValuesDonationsAndPledgesAtPar() public {
        MockToken token = new MockToken(6);
        uint256 id = ballots.registerCurrency(address(token), address(0), 0);
        RoundAccounting.Currency memory c = ballots.currency(id);
        assertEq(c.usdFeed, address(0));
        assertEq(c.amountDecimals, 6);
        assertEq(c.feedDecimals, 0);
        assertEq(c.maxPriceAge, 0);
        token.mint(INITIATIVE_A, 400e6);
        ballots.setPledge(keccak256("fixed dollar pledge"), 0, id, 50e6);
        ballots.setPoolUsd(300e6);
        // A failing oracle for an unused currency cannot affect fixed pricing.
        usdcFeed.setUnavailable(true);
        ethFeed.setUnavailable(true);
        (uint256 donated, uint256 pledged, uint256 total, uint256 ask) = ballots.initiativeUsd(0);
        assertEq(donated, 400e6);
        assertEq(pledged, 50e6);
        assertEq(total, 450e6);
        assertEq(ask, 19_550e6);
        assertEq(ballots.poolUsd(), 300e6);
        (uint256 tokens, uint256 promises) = ballots.initiativeCurrencyAmounts(0, id);
        assertEq(tokens, 400e6);
        assertEq(promises, 50e6);
    }

    function testFuzz_fixedUsdPricingScalesTokenDecimals(uint128 amount, uint8 decimals) public {
        decimals = uint8(bound(decimals, 0, 18));
        MockToken token = new MockToken(decimals);
        uint256 id = ballots.registerCurrency(address(token), address(0), 0);
        uint256 expected = uint256(amount) * 1e6 / 10 ** uint256(decimals);
        assertEq(ballots.quoteUsd(id, amount), expected);
        assertEq(ballots.quoteUsd(id, 10 ** uint256(decimals)), 1e6);
        assertEq(ballots.quoteUsd(id, 0), 0);
    }

    function test_fixedUsdTokenDecimalsCannotSilentlyChange() public {
        MockToken token = new MockToken(6);
        uint256 id = ballots.registerCurrency(address(token), address(0), 0);
        token.setDecimals(18);
        vm.expectRevert(RoundAccounting.InvalidCurrency.selector);
        ballots.quoteUsd(id, 1e6);
    }

    function test_fixedUsdPricingRequiresExplicitValidTokenConfiguration() public {
        MockToken token = new MockToken(6);
        vm.expectRevert(RoundAccounting.InvalidCurrency.selector);
        ballots.registerCurrency(address(token), address(0), 3600);
        vm.expectRevert(RoundAccounting.InvalidCurrency.selector);
        ballots.registerCurrency(address(token), address(usdcFeed), 0);
        vm.expectRevert(RoundAccounting.InvalidCurrency.selector);
        ballots.registerCurrency(bob, address(0), 0);
        MockToken excessiveDecimals = new MockToken(19);
        vm.expectRevert(RoundAccounting.InvalidCurrency.selector);
        ballots.registerCurrency(address(excessiveDecimals), address(0), 0);
        SignedBallots fresh = new SignedBallots(address(this), address(0), "Voter", "VOTE", schedule());
        vm.expectRevert(RoundAccounting.InvalidCurrency.selector);
        fresh.registerCurrency(address(0), address(0), 0);
    }

    function test_USDUnitIsNotANativeBalanceOrATokenBalance() public {
        vm.deal(INITIATIVE_A, 1 ether);
        ballots.setPledge(keccak256("usd"), 0, ballots.USD(), 10e6);
        (uint256 donated, uint256 pledged) = ballots.initiativeCurrencyAmounts(0, ballots.USD());
        assertEq(donated, 0);
        assertEq(pledged, 10e6);
        assertEq(ballots.quoteUsd(ballots.USD(), 123_456), 123_456);
        ballots.setPoolUsd(2_000e6);
        assertEq(ballots.poolUsd(), 2_000e6);
    }

    function test_precisionAndRoundingDown() public {
        MockToken token = new MockToken(2);
        MockFeed feed = new MockFeed(2, 321); // $3.21.
        uint256 id = ballots.registerCurrency(address(token), address(feed), 3600);
        assertEq(ballots.quoteUsd(id, 123), 3_948_300); // 1.23 * 3.21 dollars.
        assertEq(ballots.quoteUsd(eth, 1), 0); // One wei is less than one microdollar.
        MockToken btc = new MockToken(8);
        MockFeed btcFeed = new MockFeed(8, 60_000e8);
        uint256 btcId = ballots.registerCurrency(address(btc), address(btcFeed), 3600);
        assertEq(ballots.quoteUsd(btcId, 2e8), 120_000e6);
    }

    function testFuzz_conversionHasOneFinalRounding(uint128 amount, uint64 price) public {
        amount = uint128(bound(amount, 1, 1e24));
        price = uint64(bound(price, 1, 1e12));
        ethFeed.set(int256(uint256(price)), block.timestamp);
        uint256 expected = uint256(amount) * uint256(price) * 1e6 / 1e26;
        assertEq(ballots.quoteUsd(eth, amount), expected);
    }

    function test_zeroNegativeIncompleteAndFutureOraclePricesRevert() public {
        ethFeed.set(0, block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(RoundAccounting.InvalidPrice.selector, eth));
        ballots.quoteUsd(eth, 1 ether);
        ethFeed.set(-1, block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(RoundAccounting.InvalidPrice.selector, eth));
        ballots.quoteUsd(eth, 1 ether);
        ethFeed.set(2_000e8, 0);
        vm.expectRevert(abi.encodeWithSelector(RoundAccounting.InvalidPrice.selector, eth));
        ballots.quoteUsd(eth, 1 ether);
        ethFeed.set(2_000e8, block.timestamp + 1);
        vm.expectRevert(abi.encodeWithSelector(RoundAccounting.InvalidPrice.selector, eth));
        ballots.quoteUsd(eth, 1 ether);
        ethFeed.set(2_000e8, block.timestamp);
        ethFeed.setRound(0);
        vm.expectRevert(abi.encodeWithSelector(RoundAccounting.InvalidPrice.selector, eth));
        ballots.quoteUsd(eth, 1 ether);
    }

    function test_stalenessIsCheckedAtTheViewBlock() public {
        uint256 timestamp = block.timestamp;
        vm.warp(timestamp + 3600);
        assertEq(ballots.quoteUsd(eth, 1 ether), 2_000e6);
        vm.warp(timestamp + 3601);
        vm.expectRevert(abi.encodeWithSelector(RoundAccounting.StalePrice.selector, eth));
        ballots.quoteUsd(eth, 1 ether);
        ethFeed.set(2_100e8, block.timestamp);
        assertEq(ballots.quoteUsd(eth, 1 ether), 2_100e6);
    }

    function test_oracleDecimalsCannotSilentlyChange() public {
        ethFeed.setDecimals(18);
        vm.expectRevert(abi.encodeWithSelector(RoundAccounting.InvalidPrice.selector, eth));
        ballots.quoteUsd(eth, 1 ether);
    }

    function test_assetDecimalsCannotSilentlyChange() public {
        usdc.setDecimals(18);
        vm.expectRevert(RoundAccounting.InvalidCurrency.selector);
        ballots.quoteUsd(dollarToken, 1e6);
    }

    function test_currencyLimitBoundsValuationLoops() public {
        MockToken extra;
        for (uint256 i = ballots.currencyCount(); i < ballots.MAX_CURRENCIES(); ++i) {
            extra = new MockToken(6);
            ballots.registerCurrency(address(extra), address(usdcFeed), 3600);
        }
        extra = new MockToken(6);
        vm.expectRevert(RoundAccounting.TooManyCurrencies.selector);
        ballots.registerCurrency(address(extra), address(usdcFeed), 3600);
    }

    function test_unusedCurrencyDoesNotRequireAPriceButNonzeroSupportDoes() public {
        ballots.setPoolUsd(100e6);
        ethFeed.setUnavailable(true);
        usdc.mint(INITIATIVE_A, 10e6);
        (uint256 donated,,,) = ballots.initiativeUsd(0);
        assertEq(donated, 10e6);
        assertEq(ballots.poolUsd(), 100e6);
        vm.deal(INITIATIVE_A, 1 ether);
        vm.expectRevert();
        ballots.initiativeUsd(0);
        assertEq(ballots.poolUsd(), 100e6);
    }

    function test_enormousOracleAnswerRevertsWithoutOverflowingConversion() public {
        ethFeed.set(type(int256).max, block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(RoundAccounting.InvalidPrice.selector, eth));
        ballots.quoteUsd(eth, 1 ether);
    }

    function test_rolesCanBeGrantedAndRevokedIndependently() public {
        bytes32 adminRole = ballots.ADMIN_ROLE();
        bytes32 pledgeRole = ballots.PLEDGE_ROLE();
        vm.prank(bob);
        vm.expectRevert();
        ballots.setPoolUsd(800_000e6);
        vm.prank(bob);
        vm.expectRevert();
        ballots.setPledge(keccak256("p"), 0, eth, 1 ether);
        ballots.grantRole(pledgeRole, bob);
        vm.prank(bob);
        ballots.setPledge(keccak256("p"), 0, eth, 1 ether);
        vm.prank(bob);
        vm.expectRevert();
        ballots.setPoolUsd(800_000e6);
        ballots.revokeRole(pledgeRole, bob);
        vm.prank(bob);
        vm.expectRevert();
        ballots.setPledge(keccak256("p"), 0, eth, 0);
        ballots.grantRole(adminRole, bob);
        vm.prank(bob);
        ballots.setPoolUsd(600_000e6);
        assertEq(ballots.poolUsd(), 600_000e6);
        ballots.revokeRole(adminRole, bob);
        vm.prank(bob);
        vm.expectRevert();
        ballots.setPoolUsd(1e6);
        assertEq(ballots.poolUsd(), 600_000e6);
    }

    function test_definitionsFreezeWhileFundingAndPledgesRemainOpenThroughWindows() public {
        MockToken other = new MockToken(8);
        ballots.setPoolUsd(800_000e6);
        vm.warp(start);
        vm.expectRevert(SignedBallots.ConfigurationFrozen.selector);
        ballots.registerCurrency(address(other), address(ethFeed), 3600);
        vm.warp(ballots.registrationDeadline());
        ballots.setPoolUsd(900_000e6);
        ballots.setPledge(keccak256("late"), 0, eth, 1 ether);
        vm.warp(ballots.hardDeadline() - 1);
        ballots.setPledge(keccak256("late"), 0, eth, 2 ether);
        assertEq(ballots.pledgedAmount(0, eth), 2 ether);
        vm.warp(ballots.hardDeadline());
        vm.expectRevert(SignedBallots.VotingClosed.selector);
        ballots.setPoolUsd(1_000_000e6);
        vm.expectRevert(SignedBallots.VotingClosed.selector);
        ballots.setPledge(keccak256("late"), 0, eth, 0);
        assertEq(ballots.poolUsd(), 900_000e6);
    }

    function test_duplicateUnknownAndInvalidRecordsReject() public {
        MockToken other = new MockToken(6);
        MockToken excessiveDecimals = new MockToken(19);
        vm.expectRevert(RoundAccounting.DuplicateCurrency.selector);
        ballots.registerCurrency(address(0), address(ethFeed), 3600);
        vm.expectRevert(RoundAccounting.InvalidCurrency.selector);
        ballots.registerCurrency(address(other), address(0), 3600);
        vm.expectRevert(RoundAccounting.InvalidCurrency.selector);
        ballots.registerCurrency(address(excessiveDecimals), address(ethFeed), 3600);
        vm.expectRevert(RoundAccounting.DuplicateInitiative.selector);
        ballots.addInitiative(INITIATIVE_A, 1e6);
        vm.expectRevert(RoundAccounting.InvalidAddress.selector);
        ballots.addInitiative(address(ballots), 1e6);
        vm.expectRevert(RoundAccounting.UnknownCurrency.selector);
        ballots.quoteUsd(999, 0);
        vm.expectRevert(RoundAccounting.UnknownInitiative.selector);
        ballots.initiativeUsd(999);
        vm.expectRevert(RoundAccounting.InvalidPledgeId.selector);
        ballots.setPledge(bytes32(0), 0, eth, 1);
    }

    function test_initiativeEditsKeepBalanceOwnershipUnambiguous() public {
        vm.expectRevert(RoundAccounting.DuplicateInitiative.selector);
        ballots.setInitiative(0, INITIATIVE_B, 1e6);
        ballots.setInitiative(0, address(0xA04), 123e6);
        ballots.addInitiative(INITIATIVE_A, 1e6); // Old address is available again.
        RoundAccounting.Initiative memory p = ballots.initiative(0);
        assertEq(p.account, address(0xA04));
        assertEq(p.askUsd, 123e6);
    }
}
