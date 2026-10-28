// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {TenorTestBase} from "./Tenor.Base.t.sol";
import {Tenor} from "../Tenor.sol";

/// @dev Variation margin (mark), margin calls, top-ups, withdrawExcess.
contract TenorMarkTest is TenorTestBase {
    function _markScenario(Tenor.Side side, uint256 newSpot, int256 expectedHedgerMtm) internal returns (uint256 id) {
        id = _openTrade(side, false);
        vm.warp(T0 + 61);
        _setSpot(newSpot);

        int256 mtm = _mtmHedger(id);
        assertEq(mtm, expectedHedgerMtm, "independent mtm vs python literal");
        uint256 fwd = _fair(newSpot, 30 days - 61, RUSD, REUR);

        vm.expectEmit(true, false, false, true, address(tenor));
        emit Tenor.Marked(id, newSpot * 1e10, fwd, mtm, mtm);
        tenor.mark(id);

        Tenor.Trade memory t = tenor.getTrade(id);
        assertEq(int256(t.hedgerMargin), int256(IM) + mtm, "hedger margin");
        assertEq(int256(t.dealerMargin), int256(IM) - mtm, "dealer margin");
        assertEq(t.hedgerMargin + t.dealerMargin, 2 * IM, "VM is zero-sum");
        assertEq(t.lastMtmHedger, mtm);
        assertEq(t.lastMarkAt, T0 + 61);
        assertEq(t.callParty, 0, "no call: both above 3% maintenance");
        assertEq(tenor.currentMtm(id), mtm);
    }

    function test_Mark_SellUsd_EurUp_HedgerGains() public {
        _markScenario(Tenor.Side.SELL_USD, 1.12e8, 181817);
    }

    function test_Mark_SellUsd_EurDown_HedgerLoses() public {
        _markScenario(Tenor.Side.SELL_USD, 1.08e8, -181818);
    }

    function test_Mark_BuyUsd_EurUp_HedgerLoses() public {
        _markScenario(Tenor.Side.BUY_USD, 1.12e8, -181817);
    }

    function test_Mark_BuyUsd_EurDown_HedgerGains() public {
        _markScenario(Tenor.Side.BUY_USD, 1.08e8, 181818);
    }

    function test_Mark_IncrementalMovesOnlyDelta() public {
        uint256 id = _markScenario(Tenor.Side.SELL_USD, 1.12e8, 181817);
        vm.warp(T0 + 121);
        _setSpot(1.10e8);
        int256 mtm2 = _mtmHedger(id);
        tenor.mark(id);
        Tenor.Trade memory t = tenor.getTrade(id);
        assertEq(int256(t.hedgerMargin), int256(IM) + mtm2);
        assertEq(int256(t.dealerMargin), int256(IM) - mtm2);
        assertEq(t.lastMtmHedger, mtm2);
    }

    function test_Mark_RevertsMarkTooSoon() public {
        uint256 id = _openTrade(Tenor.Side.SELL_USD, false);
        vm.expectRevert(Tenor.MarkTooSoon.selector);
        tenor.mark(id);
        vm.warp(T0 + 59);
        vm.expectRevert(Tenor.MarkTooSoon.selector);
        tenor.mark(id);
        vm.warp(T0 + 60);
        tenor.mark(id); // exactly one interval is allowed
        vm.expectRevert(Tenor.MarkTooSoon.selector);
        tenor.mark(id);
    }

    function test_Mark_RevertsStalePrice() public {
        uint256 id = _openTrade(Tenor.Side.SELL_USD, false);
        vm.warp(T0 + 90_001);
        vm.expectRevert(Tenor.StalePrice.selector);
        tenor.mark(id);
        vm.warp(T0 + 90_000); // age == maxStaleness is still fresh
        tenor.mark(id);
    }

    function test_Mark_RevertsBadPrice() public {
        uint256 id = _openTrade(Tenor.Side.SELL_USD, false);
        vm.warp(T0 + 61);
        vm.startPrank(owner);
        feed.setAnswer(0);
        vm.stopPrank();
        vm.expectRevert(Tenor.BadPrice.selector);
        tenor.mark(id);
        vm.prank(owner);
        feed.setAnswer(-1e8);
        vm.expectRevert(Tenor.BadPrice.selector);
        tenor.mark(id);
        vm.prank(owner);
        feed.setAnswerAt(1.1e8, block.timestamp + 1); // from the future
        vm.expectRevert(Tenor.BadPrice.selector);
        tenor.mark(id);
        vm.prank(owner);
        feed.setAnswerAt(1.1e8, 0); // never updated
        vm.expectRevert(Tenor.BadPrice.selector);
        tenor.mark(id);
    }

    function test_Mark_BadPriceAlsoBlocksOpenAndQuote() public {
        vm.prank(owner);
        feed.setAnswer(-5);
        vm.expectRevert(Tenor.BadPrice.selector);
        tenor.quote(1e6, 1 days);
    }

    function test_Mark_TradeNotFound() public {
        vm.expectRevert(Tenor.TradeNotFound.selector);
        tenor.mark(99);
    }

    // ------------------------------ margin call / topUp / withdrawExcess ------------------------------

    /// SELL_USD, EUR rallies to 1.15: hedger +454545, dealer margin 45455 < 300000 maintenance.
    function _calledDealerTrade() internal returns (uint256 id) {
        id = _openTrade(Tenor.Side.SELL_USD, false);
        vm.warp(T0 + 61);
        _setSpot(1.15e8);
        vm.expectEmit(true, true, false, true, address(tenor));
        emit Tenor.MarginCalled(id, dealer, T0 + 61 + 120);
        tenor.mark(id);
    }

    function test_MarginCall_RaisedOnMark() public {
        uint256 id = _calledDealerTrade();
        (uint256 hm, uint256 dm, uint256 maint, uint8 cp, uint256 dl, int256 last) = tenor.health(id);
        assertEq(hm, IM + 454545);
        assertEq(dm, IM - 454545);
        assertEq(maint, MAINT);
        assertEq(cp, 2, "dealer called");
        assertEq(dl, T0 + 181);
        assertEq(last, 454545);
    }

    function test_TopUp_PartialDoesNotCure_FullCures() public {
        uint256 id = _calledDealerTrade();
        _fund(dealer, 1_000_000);
        vm.prank(dealer);
        tenor.topUp(id, 100_000);
        (, uint256 dm, , uint8 cp,,) = tenor.health(id);
        assertEq(dm, 45_455 + 100_000);
        assertEq(cp, 2, "still below initial margin");

        uint256 need = IM - dm; // restore to initial margin (5%), not just maintenance
        vm.expectEmit(true, true, false, false, address(tenor));
        emit Tenor.MarginCured(id, dealer);
        vm.prank(dealer);
        tenor.topUp(id, need);
        (, dm, , cp,,) = tenor.health(id);
        assertEq(dm, IM);
        assertEq(cp, 0, "cured");
        assertEq(tenor.usdcBalance(dealer), 1_000_000 - 100_000 - need);
        // cured => closeOut impossible
        vm.warp(T0 + 10_000);
        vm.expectRevert(Tenor.NoMarginCall.selector);
        tenor.closeOut(id);
    }

    function test_TopUp_ByWrongPartyDoesNotCure() public {
        uint256 id = _calledDealerTrade();
        _fund(hedger, 1_000_000);
        vm.prank(hedger);
        tenor.topUp(id, 1_000_000); // hedger tops up their own side
        (,,, uint8 cp,,) = tenor.health(id);
        assertEq(cp, 2, "dealer's call is unaffected");
    }

    function test_Mark_PriceRecoveryCuresCall() public {
        uint256 id = _calledDealerTrade();
        vm.warp(T0 + 122);
        _setSpot(1.10e8);
        int256 mtm = _mtmHedger(id);
        assertLe(mtm, int256(0), "forward at/below contract rate after carry roll-down (rounds to ~0)");
        vm.expectEmit(true, true, false, false, address(tenor));
        emit Tenor.MarginCured(id, dealer);
        tenor.mark(id);
        (, uint256 dm,, uint8 cp,,) = tenor.health(id);
        assertEq(int256(dm), int256(IM) - mtm);
        assertEq(cp, 0);
    }

    function test_WithdrawExcess_RevertsMarginLockedWhileCallOpen() public {
        uint256 id = _calledDealerTrade();
        _fund(dealer, 1_000_000);
        vm.prank(dealer);
        tenor.topUp(id, 200_000); // not enough to cure; excess exists in principle
        vm.expectRevert(Tenor.MarginLocked.selector);
        vm.prank(dealer);
        tenor.withdrawExcess(id, 1);
        vm.expectRevert(Tenor.MarginLocked.selector);
        vm.prank(hedger);
        tenor.withdrawExcess(id, 1);
    }

    function test_WithdrawExcess_AfterCure_DealerCanWithdrawOnlyAboveInitial() public {
        uint256 id = _calledDealerTrade();
        _fund(dealer, 2_000_000);
        vm.prank(dealer);
        tenor.topUp(id, 454_545 + 300_000); // cures and leaves 300000 above initial margin
        (, uint256 dm,, uint8 cp,,) = tenor.health(id);
        assertEq(cp, 0);
        assertEq(dm, IM + 300_000);
        vm.expectRevert(Tenor.InsufficientMargin.selector);
        vm.prank(dealer);
        tenor.withdrawExcess(id, 300_001);
        uint256 before = tenor.usdcBalance(dealer);
        vm.prank(dealer);
        tenor.withdrawExcess(id, 300_000);
        assertEq(tenor.usdcBalance(dealer), before + 300_000);
        (, dm,,,,) = tenor.health(id);
        assertEq(dm, IM);
    }

    function test_WithdrawExcess_PhysicalHedgerCannotWithdrawVmGains_CashCan() public {
        // physical: VM received stays locked (will be unwound at delivery)
        uint256 id = _openTrade(Tenor.Side.SELL_USD, false);
        vm.warp(T0 + 61);
        _setSpot(1.12e8);
        tenor.mark(id);
        vm.expectRevert(Tenor.InsufficientMargin.selector);
        vm.prank(hedger);
        tenor.withdrawExcess(id, 1);
        // cash-settled twin: gains above initial margin are withdrawable
        Tenor.Quote memory q = _mkQuote(Tenor.Side.SELL_USD, N, 30 days, true);
        q.nonce = 777;
        uint256 id2 = _openQuote(q);
        vm.warp(T0 + 200);
        _setSpot(1.14e8);
        tenor.mark(id2);
        (uint256 hm,,,,,) = tenor.health(id2);
        assertGt(hm, IM);
        vm.prank(hedger);
        tenor.withdrawExcess(id2, hm - IM);
        (hm,,,,,) = tenor.health(id2);
        assertEq(hm, IM);
        vm.expectRevert(Tenor.InsufficientMargin.selector);
        vm.prank(hedger);
        tenor.withdrawExcess(id2, 1);
    }

    function test_TopUp_And_WithdrawExcess_Reverts() public {
        uint256 id = _openTrade(Tenor.Side.SELL_USD, false);
        vm.expectRevert(Tenor.NotParty.selector);
        vm.prank(stranger);
        tenor.topUp(id, 1);
        vm.expectRevert(Tenor.NotParty.selector);
        vm.prank(stranger);
        tenor.withdrawExcess(id, 0);
        vm.expectRevert(Tenor.ZeroAmount.selector);
        vm.prank(hedger);
        tenor.topUp(id, 0);
        vm.expectRevert(Tenor.InsufficientMargin.selector);
        vm.prank(hedger);
        tenor.topUp(id, 1); // free balance is zero after open
    }

    function test_TopUp_Voluntary_ThenWithdrawExcessRoundTrip() public {
        uint256 id = _openTrade(Tenor.Side.BUY_USD, false);
        _fund(hedger, 400_000);
        vm.prank(hedger);
        tenor.topUp(id, 400_000);
        (uint256 hm,,,,,) = tenor.health(id);
        assertEq(hm, IM + 400_000);
        vm.prank(hedger);
        tenor.withdrawExcess(id, 400_000);
        assertEq(tenor.usdcBalance(hedger), 400_000);
    }
}
