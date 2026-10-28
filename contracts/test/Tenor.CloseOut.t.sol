// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {TenorTestBase} from "./Tenor.Base.t.sol";
import {Tenor} from "../Tenor.sol";

/// @dev closeOut after an uncured margin call, shortfall accounting, TradeClosed.
contract TenorCloseOutTest is TenorTestBase {
    /// Opens `side` (physical) at T0, marks at T0+61 with `spot`; returns id. Call deadline = T0+181.
    function _called(Tenor.Side side, uint256 spot) internal returns (uint256 id) {
        id = _openTrade(side, false);
        vm.warp(T0 + 61);
        _setSpot(spot);
        tenor.mark(id);
    }

    function _bal(address a) internal view returns (uint256) {
        return tenor.usdcBalance(a);
    }

    function test_CloseOut_Reverts_NoMarginCall() public {
        uint256 id = _openTrade(Tenor.Side.SELL_USD, false);
        vm.expectRevert(Tenor.NoMarginCall.selector);
        tenor.closeOut(id);
    }

    function test_CloseOut_Reverts_CureWindowOpen() public {
        uint256 id = _called(Tenor.Side.SELL_USD, 1.15e8);
        vm.expectRevert(Tenor.CureWindowOpen.selector);
        tenor.closeOut(id);
        vm.warp(T0 + 181); // deadline itself is still inside the window
        vm.expectRevert(Tenor.CureWindowOpen.selector);
        tenor.closeOut(id);
    }

    function test_CloseOut_Reverts_TradeNotFound() public {
        vm.expectRevert(Tenor.TradeNotFound.selector);
        tenor.closeOut(1);
    }

    /// Spot unchanged since the mark: the fresh sweep returns only 1 wei of carry roll-down to the dealer.
    function test_CloseOut_Dealer_SpotUnchanged_ExactAmounts() public {
        uint256 id = _called(Tenor.Side.SELL_USD, 1.15e8);
        vm.warp(T0 + 182);
        assertEq(_mtmHedger(id), int256(454544), "python literal at +182s");
        vm.expectEmit(true, true, false, true, address(tenor));
        emit Tenor.ClosedOut(id, dealer, 0, 45_456);
        vm.prank(stranger); // anyone may trigger
        tenor.closeOut(id);

        assertEq(_bal(hedger), 954_544);
        assertEq(_bal(dealer), 45_456);
        _assertClosed(id);
    }

    /// Price moves further before close-out; the non-defaulter is topped up from dealer margin.
    function test_CloseOut_Dealer_PartialTopUp_EventPaid() public {
        uint256 id = _called(Tenor.Side.SELL_USD, 1.15e8);
        vm.warp(T0 + 100);
        _setSpot(1.152e8);
        vm.warp(T0 + 182);
        assertEq(_mtmHedger(id), int256(472_726), "python literal");
        // fresh sweep: 472726 - 454545 = 18181 paid out of dealer's 45455
        vm.expectEmit(true, true, false, true, address(tenor));
        emit Tenor.ClosedOut(id, dealer, 18_181, 27_274);
        tenor.closeOut(id);
        assertEq(_bal(hedger), 972_726);
        assertEq(_bal(dealer), 27_274);
        assertEq(tenor.getTrade(id).dealerShortfall, 0);
        _assertClosed(id);
    }

    /// Dealer cannot cover the further move: partial payment + ShortfallRecorded for the rest.
    function test_CloseOut_Dealer_Shortfall_Recorded() public {
        uint256 id = _called(Tenor.Side.SELL_USD, 1.15e8);
        vm.warp(T0 + 100);
        _setSpot(1.16e8);
        vm.warp(T0 + 182);
        assertEq(_mtmHedger(id), int256(545_453), "python literal");
        // owed = 545453 - 454545 = 90908; dealer has 45455 => shortfall 45453
        vm.expectEmit(true, true, false, true, address(tenor));
        emit Tenor.ShortfallRecorded(id, dealer, 45_453);
        vm.expectEmit(true, true, false, true, address(tenor));
        emit Tenor.ClosedOut(id, dealer, 45_455, 0);
        tenor.closeOut(id);
        assertEq(_bal(hedger), 1_000_000, "hedger receives all margin on the trade");
        assertEq(_bal(dealer), 0);
        assertEq(tenor.getTrade(id).dealerShortfall, 45_453);
        assertEq(tenor.getTrade(id).hedgerShortfall, 0);
        _assertClosed(id);
    }

    /// EUR collapses: hedger (long EUR) is wiped out; nothing left to pay the dealer.
    function test_CloseOut_Hedger_Shortfall_FullMarginLost() public {
        uint256 id = _called(Tenor.Side.SELL_USD, 0.9e8);
        (uint256 hm, uint256 dm,, uint8 cp,, int256 last) = tenor.health(id);
        assertEq(hm, 0);
        assertEq(dm, 2 * IM);
        assertEq(cp, 1, "hedger called");
        assertEq(last, -int256(IM), "VM capped at available margin");
        vm.warp(T0 + 182);
        assertEq(_mtmHedger(id), int256(-1_818_182), "python literal");
        // dealer entitled to 1818182; already received 500000 => 1318182 uncollectable
        vm.expectEmit(true, true, false, true, address(tenor));
        emit Tenor.ShortfallRecorded(id, hedger, 1_318_182);
        vm.expectEmit(true, true, false, true, address(tenor));
        emit Tenor.ClosedOut(id, hedger, 0, 0);
        tenor.closeOut(id);
        assertEq(_bal(hedger), 0);
        assertEq(_bal(dealer), 1_000_000);
        assertEq(tenor.getTrade(id).hedgerShortfall, 1_318_182);
    }

    /// Mirror image with BUY_USD: EUR up hurts the hedger.
    function test_CloseOut_BuyUsd_HedgerDefaults_SpotUnchanged() public {
        uint256 id = _called(Tenor.Side.BUY_USD, 1.15e8);
        (,,, uint8 cp,,) = tenor.health(id);
        assertEq(cp, 1);
        vm.warp(T0 + 182);
        vm.expectEmit(true, true, false, true, address(tenor));
        emit Tenor.ClosedOut(id, hedger, 0, 45_456);
        tenor.closeOut(id);
        assertEq(_bal(hedger), 45_456);
        assertEq(_bal(dealer), 954_544);
    }

    /// With a dead/stale oracle the close-out falls back to the last marked VM (no revert, no griefing).
    function test_CloseOut_StaleOracleFallsBackToLastMtm() public {
        uint256 id = _called(Tenor.Side.SELL_USD, 1.15e8);
        vm.warp(T0 + 61 + 90_001);
        vm.expectRevert(Tenor.StalePrice.selector);
        tenor.currentMtm(id);
        tenor.closeOut(id);
        assertEq(_bal(hedger), IM + 454_545);
        assertEq(_bal(dealer), IM - 454_545);
    }

    function test_CloseOut_RefundsFundedLegToItsOwner() public {
        uint256 id = _called(Tenor.Side.SELL_USD, 1.15e8);
        vm.warp(T0 + 30 days);
        _setSpot(1.15e8);
        _wallet(hedger, N, 0);
        vm.prank(hedger);
        tenor.fundLeg(id); // hedger sells USD: funds notional USDC
        uint256 hedgerBefore = _bal(hedger);
        assertEq(hedgerBefore, 0);
        int256 mtm = _mtmHedger(id);
        assertEq(mtm, int256(437_423), "python-independent: at maturity forward == spot, carry gone");
        tenor.closeOut(id);
        assertEq(_bal(hedger), N + IM + 437_423, "usd leg refunded + margin + VM");
        assertEq(_bal(dealer), IM - 437_423);
        assertEq(tenor.getTrade(id).usdLegAmount, 0);
    }

    function test_TradeClosed_AfterCloseOut() public {
        uint256 id = _called(Tenor.Side.SELL_USD, 1.15e8);
        vm.warp(T0 + 182);
        tenor.closeOut(id);
        vm.warp(T0 + 400);
        _setSpot(1.15e8);

        vm.expectRevert(Tenor.TradeClosed.selector);
        tenor.mark(id);
        vm.expectRevert(Tenor.TradeClosed.selector);
        vm.prank(hedger);
        tenor.topUp(id, 1);
        vm.expectRevert(Tenor.TradeClosed.selector);
        vm.prank(hedger);
        tenor.withdrawExcess(id, 0);
        vm.expectRevert(Tenor.TradeClosed.selector);
        vm.prank(hedger);
        tenor.fundLeg(id);
        vm.expectRevert(Tenor.TradeClosed.selector);
        tenor.settle(id);
        vm.expectRevert(Tenor.TradeClosed.selector);
        tenor.closeOut(id);
    }

    function _assertClosed(uint256 id) internal view {
        Tenor.Trade memory t = tenor.getTrade(id);
        assertEq(uint8(t.status), uint8(Tenor.Status.ClosedOut));
        assertEq(t.hedgerMargin, 0);
        assertEq(t.dealerMargin, 0);
        assertEq(t.callParty, 0);
        assertEq(t.callDeadline, 0);
        assertEq(_bal(hedger) + _bal(dealer), 2 * IM, "margin fully conserved");
    }
}
