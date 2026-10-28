// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {TenorTestBase} from "./Tenor.Base.t.sol";
import {Tenor} from "../Tenor.sol";

/// @dev Quote pricing (covered interest parity) and trade admission (open).
contract TenorQuoteOpenTest is TenorTestBase {
    // ------------------------------------- quote() -------------------------------------

    function _checkQuote(uint256 spot8, uint256 rU, uint256 rE, uint256 tenorSecs, uint256 expected) internal {
        vm.startPrank(owner);
        tenor.setRates(rU, rE);
        vm.stopPrank();
        _setSpot(spot8);
        // independent reference agrees with the hard-coded literal (computed offline in python)
        assertEq(_fair(spot8, tenorSecs, rU, rE), expected, "reference vs literal");
        (uint256 spot, uint256 fair, uint256 lo, uint256 hi, uint256 im) = tenor.quote(1e6, tenorSecs);
        assertEq(spot, spot8 * 1e10, "spot");
        assertEq(fair, expected, "forward");
        uint256 band = (expected * 50) / 10_000;
        assertEq(lo, expected - band, "bandLow");
        assertEq(hi, expected + band, "bandHigh");
        assertEq(im, 50_000, "5% margin on 1 USDC");
        // sanity vs exact rational CIP (continuous floor error <= a couple of wei)
        uint256 exact = (spot8 * 1e10 * (YEAR * 1e18 + rU * tenorSecs)) / (YEAR * 1e18 + rE * tenorSecs);
        assertApproxEqAbs(fair, exact, 3, "within wei of exact rational CIP");
    }

    function test_Quote_Cip_Table() public {
        _checkQuote(110000000, 45000000000000000, 25000000000000000, 300, 1100000209284577319);
        _checkQuote(110000000, 45000000000000000, 25000000000000000, 86400, 1100060269844531196);
        _checkQuote(110000000, 45000000000000000, 25000000000000000, 2592000, 1101804511278195488);
        _checkQuote(108500000, 50000000000000000, 30000000000000000, 7776000, 1090311395159097090);
        _checkQuote(95000000, 10000000000000000, 40000000000000000, 15552000, 936217087587318646);
        _checkQuote(120000000, 0, 0, 8640000, 1200000000000000000);
        _checkQuote(100000000, 500000000000000000, 0, 31622400, 1501369863013698630);
        _checkQuote(100000000, 0, 500000000000000000, 31622400, 666058394160583941);
        _checkQuote(123456789, 52500000000000000, 22500000000000000, 604800, 1235277882967144314);
    }

    function test_Quote_ZeroTenorIsSpot() public view {
        (, uint256 fair,,,) = tenor.quote(1e6, 0);
        assertEq(fair, SPOT * 1e10);
    }

    function test_Quote_HigherUsdRateMeansForwardPremium() public view {
        (, uint256 f1,,,) = tenor.quote(1e6, 30 days);
        assertGt(f1, SPOT * 1e10, "rUsd > rEur => EUR at forward premium");
    }

    function test_Quote_InitialMarginRoundsUp() public view {
        (,,,, uint256 im) = tenor.quote(333_333, 1 days);
        // 333333 * 5% = 16666.65 -> 16667
        assertEq(im, 16_667);
    }

    function test_Quote_Reverts() public {
        vm.expectRevert(Tenor.TenorTooLong.selector);
        tenor.quote(1e6, 366 days + 1);
        vm.expectRevert(Tenor.ZeroAmount.selector);
        tenor.quote(0, 1 days);
        vm.expectRevert(Tenor.NotionalTooLarge.selector);
        tenor.quote(50e6 + 1, 1 days);
        // boundaries are accepted
        tenor.quote(50e6, 366 days);
    }

    function test_HashQuote_MatchesIndependentEip712Digest() public {
        Tenor.Quote memory q = _mkQuote(Tenor.Side.SELL_USD, N, 30 days, false);
        bytes32 expected = _digest(q);
        // hashQuote returns the structHash-wrapped typed data hash (what must be signed)
        assertEq(tenor.hashQuote(q), expected);
    }

    // -------------------------------------- open() --------------------------------------

    function test_Open_HappyPath_SellUsd() public {
        Tenor.Quote memory q = _mkQuote(Tenor.Side.SELL_USD, N, 30 days, false);
        _fund(hedger, IM + 123);
        _fund(dealer, IM);
        bytes memory sig = _sign(dealerPk, q);

        vm.expectEmit(true, true, true, true, address(tenor));
        emit Tenor.TradeOpened(1, hedger, dealer, Tenor.Side.SELL_USD, N, q.rate, q.maturity, false, IM);
        vm.prank(hedger);
        uint256 id = tenor.open(q, sig);

        assertEq(id, 1);
        assertEq(tenor.nextTradeId(), 2);
        assertTrue(tenor.nonceUsed(dealer, q.nonce));
        assertEq(tenor.usdcBalance(hedger), 123, "only margin debited");
        assertEq(tenor.usdcBalance(dealer), 0);
        Tenor.Trade memory t = tenor.getTrade(id);
        assertEq(t.hedger, hedger);
        assertEq(t.dealer, dealer);
        assertEq(uint8(t.side), uint8(Tenor.Side.SELL_USD));
        assertEq(uint8(t.status), uint8(Tenor.Status.Open));
        assertEq(t.notionalUsd6, N);
        assertEq(t.rate, q.rate);
        assertEq(t.eurAmount6, (N * 1e18) / q.rate, "EUR principal rounds down");
        assertEq(t.maturity, q.maturity);
        assertEq(t.hedgerMargin, IM);
        assertEq(t.dealerMargin, IM);
        assertEq(t.maintenanceBps, 300);
        assertEq(t.cureWindow, 120);
        assertEq(t.deliveryGrace, 120);
        assertEq(t.lastMtmHedger, 0);
        assertEq(tenor.tradesOf(hedger).length, 1);
        assertEq(tenor.tradesOf(dealer)[0], 1);
        // tokens didn't move on open
        assertEq(usdc.balanceOf(address(tenor)), 2 * IM + 123);
    }

    function test_Open_HappyPath_BuyUsd_CashSettled_HigherMargin() public {
        Tenor.Quote memory q = _mkQuote(Tenor.Side.BUY_USD, 7_777_777, 10 days, true);
        q.initialMarginBps = 1_000; // dealer asks 10%
        uint256 m = _ceilBps(7_777_777, 1_000); // 777_778 (rounded up)
        assertEq(m, 777_778);
        _fund(hedger, m);
        _fund(dealer, m);
        vm.prank(hedger);
        uint256 id = tenor.open(q, _sign(dealerPk, q));
        Tenor.Trade memory t = tenor.getTrade(id);
        assertEq(uint8(t.side), uint8(Tenor.Side.BUY_USD));
        assertTrue(t.cashSettled);
        assertEq(t.initialMarginUsd6, m);
        assertEq(t.hedgerMargin, m);
        assertEq(t.dealerMargin, m);
    }

    function test_Open_Boundaries_RateAtBandEdgeAndTenorAtMin() public {
        Tenor.Quote memory q = _mkQuote(Tenor.Side.SELL_USD, 50e6, 300, false); // min tenor, max notional
        uint256 fair = q.rate;
        q.rate = fair + (fair * 50) / 10_000; // exactly on the upper band edge
        _openQuote(q);
        Tenor.Quote memory q2 = _mkQuote(Tenor.Side.BUY_USD, N, 300, false);
        q2.rate = q2.rate - (q2.rate * 50) / 10_000; // exactly on the lower band edge
        _openQuote(q2);
        assertEq(tenor.nextTradeId(), 3);
    }

    function _expectOpenRevert(Tenor.Quote memory q, bytes memory err) internal {
        uint256 m = _ceilBps(q.notionalUsd6 == 0 ? 1 : q.notionalUsd6, 500);
        if (m > 25e6) m = 25e6;
        _fund(hedger, m);
        _fund(q.dealer, m);
        bytes memory sig = _sign(_pkOf(q.dealer), q);
        vm.expectRevert(err);
        vm.prank(hedger);
        tenor.open(q, sig);
    }

    function test_Open_Revert_QuoteExpired() public {
        Tenor.Quote memory q = _mkQuote(Tenor.Side.SELL_USD, N, 30 days, false);
        q.quoteExpiry = block.timestamp + 10;
        _fund(hedger, IM);
        _fund(dealer, IM);
        bytes memory sig = _sign(dealerPk, q);
        vm.warp(block.timestamp + 11);
        vm.expectRevert(Tenor.QuoteExpired.selector);
        vm.prank(hedger);
        tenor.open(q, sig);
    }

    function test_Open_QuoteValidAtExactExpiry() public {
        Tenor.Quote memory q = _mkQuote(Tenor.Side.SELL_USD, N, 30 days, false);
        q.quoteExpiry = block.timestamp + 10;
        _fund(hedger, IM);
        _fund(dealer, IM);
        bytes memory sig = _sign(dealerPk, q);
        vm.warp(block.timestamp + 10);
        vm.prank(hedger);
        tenor.open(q, sig);
    }

    function test_Open_Revert_NonceUsed_Replay() public {
        Tenor.Quote memory q = _mkQuote(Tenor.Side.SELL_USD, N, 30 days, false);
        _openQuote(q);
        _fund(hedger, IM);
        _fund(dealer, IM);
        bytes memory sig = _sign(dealerPk, q);
        vm.expectRevert(Tenor.NonceUsed.selector);
        vm.prank(hedger);
        tenor.open(q, sig);
    }

    function test_Open_Revert_NonceUsed_AfterCancel() public {
        Tenor.Quote memory q = _mkQuote(Tenor.Side.SELL_USD, N, 30 days, false);
        vm.expectEmit(true, true, false, false, address(tenor));
        emit Tenor.NonceCancelled(dealer, q.nonce);
        vm.prank(dealer);
        tenor.cancelNonce(q.nonce);
        _expectOpenRevert(q, abi.encodeWithSelector(Tenor.NonceUsed.selector));
    }

    function test_Open_Revert_BadSignature_WrongSigner() public {
        Tenor.Quote memory q = _mkQuote(Tenor.Side.SELL_USD, N, 30 days, false);
        _fund(hedger, IM);
        _fund(dealer, IM);
        bytes memory sig = _sign(dealer2Pk, q); // signed by another allowed dealer
        vm.expectRevert(Tenor.BadSignature.selector);
        vm.prank(hedger);
        tenor.open(q, sig);
    }

    function test_Open_Revert_BadSignature_TamperedQuote() public {
        Tenor.Quote memory q = _mkQuote(Tenor.Side.SELL_USD, N, 30 days, false);
        _fund(hedger, 2 * IM);
        _fund(dealer, 2 * IM);
        bytes memory sig = _sign(dealerPk, q);
        q.notionalUsd6 = N + 1; // hedger tries to enlarge notional after signing
        vm.expectRevert(Tenor.BadSignature.selector);
        vm.prank(hedger);
        tenor.open(q, sig);
    }

    function test_Open_Revert_BadSignature_Garbage() public {
        Tenor.Quote memory q = _mkQuote(Tenor.Side.SELL_USD, N, 30 days, false);
        _fund(hedger, IM);
        _fund(dealer, IM);
        vm.expectRevert(Tenor.BadSignature.selector);
        vm.prank(hedger);
        tenor.open(q, hex"1234");
    }

    function test_Open_Revert_BadSignature_InvalidSide() public {
        Tenor.Quote memory q = _mkQuote(Tenor.Side.SELL_USD, N, 30 days, false);
        q.side = 2;
        _expectOpenRevert(q, abi.encodeWithSelector(Tenor.BadSignature.selector));
    }

    function test_Open_Revert_OffMarket_SellUsd_TooHigh() public {
        Tenor.Quote memory q = _mkQuote(Tenor.Side.SELL_USD, N, 30 days, false);
        q.rate = q.rate + (q.rate * 50) / 10_000 + 1;
        _expectOpenRevert(q, abi.encodeWithSelector(Tenor.OffMarketRate.selector));
    }

    function test_Open_Revert_OffMarket_SellUsd_TooLow() public {
        Tenor.Quote memory q = _mkQuote(Tenor.Side.SELL_USD, N, 30 days, false);
        q.rate = q.rate - (q.rate * 50) / 10_000 - 1;
        _expectOpenRevert(q, abi.encodeWithSelector(Tenor.OffMarketRate.selector));
    }

    function test_Open_Revert_OffMarket_BuyUsd_TooHigh() public {
        Tenor.Quote memory q = _mkQuote(Tenor.Side.BUY_USD, N, 30 days, false);
        q.rate = q.rate + (q.rate * 50) / 10_000 + 1;
        _expectOpenRevert(q, abi.encodeWithSelector(Tenor.OffMarketRate.selector));
    }

    function test_Open_Revert_OffMarket_BuyUsd_TooLow() public {
        Tenor.Quote memory q = _mkQuote(Tenor.Side.BUY_USD, N, 30 days, false);
        q.rate = q.rate - (q.rate * 50) / 10_000 - 1;
        _expectOpenRevert(q, abi.encodeWithSelector(Tenor.OffMarketRate.selector));
    }

    function test_Open_Revert_DealerNotAllowed_Removed() public {
        vm.prank(owner);
        tenor.setDealer(dealer, false);
        Tenor.Quote memory q = _mkQuote(Tenor.Side.SELL_USD, N, 30 days, false);
        _expectOpenRevert(q, abi.encodeWithSelector(Tenor.DealerNotAllowed.selector));
    }

    function test_Open_Revert_DealerNotAllowed_NeverListed() public {
        (address rogue, uint256 rogueKey) = makeAddrAndKey("rogue");
        Tenor.Quote memory q = _mkQuote(Tenor.Side.SELL_USD, N, 30 days, false);
        q.dealer = rogue;
        _fund(hedger, IM);
        _fund(rogue, IM);
        bytes memory sig = _sign(rogueKey, q); // perfectly valid signature, but not whitelisted
        vm.expectRevert(Tenor.DealerNotAllowed.selector);
        vm.prank(hedger);
        tenor.open(q, sig);
    }

    function test_Open_Revert_TenorTooShort() public {
        Tenor.Quote memory q = _mkQuote(Tenor.Side.SELL_USD, N, 299, false);
        _expectOpenRevert(q, abi.encodeWithSelector(Tenor.TenorTooShort.selector));
    }

    function test_Open_Revert_TenorTooLong() public {
        Tenor.Quote memory q = _mkQuote(Tenor.Side.SELL_USD, N, 366 days + 1, false);
        _expectOpenRevert(q, abi.encodeWithSelector(Tenor.TenorTooLong.selector));
    }

    function test_Open_Revert_NotionalTooLarge() public {
        Tenor.Quote memory q = _mkQuote(Tenor.Side.SELL_USD, 50e6 + 1, 30 days, false);
        _expectOpenRevert(q, abi.encodeWithSelector(Tenor.NotionalTooLarge.selector));
    }

    function test_Open_Revert_ZeroNotional() public {
        Tenor.Quote memory q = _mkQuote(Tenor.Side.SELL_USD, 1, 30 days, false);
        q.notionalUsd6 = 0;
        _expectOpenRevert(q, abi.encodeWithSelector(Tenor.ZeroAmount.selector));
    }

    function test_Open_Revert_InsufficientMargin_HedgerShort() public {
        Tenor.Quote memory q = _mkQuote(Tenor.Side.SELL_USD, N, 30 days, false);
        _fund(hedger, IM - 1);
        _fund(dealer, IM);
        bytes memory sig = _sign(dealerPk, q);
        vm.expectRevert(Tenor.InsufficientMargin.selector);
        vm.prank(hedger);
        tenor.open(q, sig);
    }

    function test_Open_Revert_InsufficientMargin_DealerShort() public {
        Tenor.Quote memory q = _mkQuote(Tenor.Side.BUY_USD, N, 30 days, false);
        _fund(hedger, IM);
        _fund(dealer, IM - 1);
        bytes memory sig = _sign(dealerPk, q);
        vm.expectRevert(Tenor.InsufficientMargin.selector);
        vm.prank(hedger);
        tenor.open(q, sig);
    }

    function test_Open_Revert_InsufficientMargin_QuoteBelowProtocolMinimum() public {
        Tenor.Quote memory q = _mkQuote(Tenor.Side.SELL_USD, N, 30 days, false);
        q.initialMarginBps = 499;
        _expectOpenRevert(q, abi.encodeWithSelector(Tenor.InsufficientMargin.selector));
    }

    function test_Open_Revert_InsufficientMargin_AboveHundredPercent() public {
        Tenor.Quote memory q = _mkQuote(Tenor.Side.SELL_USD, N, 30 days, false);
        q.initialMarginBps = 10_001;
        _expectOpenRevert(q, abi.encodeWithSelector(Tenor.InsufficientMargin.selector));
    }

    function test_Open_Revert_SelfTrade() public {
        Tenor.Quote memory q = _mkQuote(Tenor.Side.SELL_USD, N, 30 days, false);
        _fund(dealer, 2 * IM);
        bytes memory sig = _sign(dealerPk, q);
        vm.expectRevert(Tenor.SelfTrade.selector);
        vm.prank(dealer);
        tenor.open(q, sig);
    }

    function test_Open_Revert_StalePrice() public {
        Tenor.Quote memory q = _mkQuote(Tenor.Side.SELL_USD, N, 30 days, false);
        q.quoteExpiry = block.timestamp + 2 days;
        _fund(hedger, IM);
        _fund(dealer, IM);
        bytes memory sig = _sign(dealerPk, q);
        vm.warp(block.timestamp + 90_001);
        vm.expectRevert(Tenor.StalePrice.selector);
        vm.prank(hedger);
        tenor.open(q, sig);
    }
}
