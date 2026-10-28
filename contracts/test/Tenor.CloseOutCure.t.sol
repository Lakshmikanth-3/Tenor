// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Vm} from "forge-std/Vm.sol";
import {TenorTestBase} from "./Tenor.Base.t.sol";
import {Tenor} from "../Tenor.sol";

/// @dev closeOut first sweeps VM at a fresh price (ignoring markInterval). If the called party is
/// back at >= initial margin the call is cleared (MarginCured) and NOTHING is settled.
/// Expected numbers computed independently from MTM = N*(F-R)/R (negated for BUY_USD, floor).
contract TenorCloseOutCureTest is TenorTestBase {
    /// Opens `side` (physical), marks at T0+61 with `spot`. Call deadline = T0+181.
    function _called(Tenor.Side side, uint256 spot) internal returns (uint256 id) {
        id = _openTrade(side, false);
        vm.warp(T0 + 61);
        _setSpot(spot);
        tenor.mark(id);
    }

    function _bal(address a) internal view returns (uint256) {
        return tenor.usdcBalance(a);
    }

    function _count(Vm.Log[] memory logs, bytes32 sig) internal pure returns (uint256 n) {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics.length > 0 && logs[i].topics[0] == sig) ++n;
        }
    }

    function _assertStillOpenNoCall(uint256 id) internal view {
        Tenor.Trade memory t = tenor.getTrade(id);
        assertEq(uint8(t.status), uint8(Tenor.Status.Open), "trade still Open");
        assertEq(t.callParty, 0, "call cleared");
        assertEq(t.callDeadline, 0, "deadline cleared");
        assertEq(_bal(hedger), 0, "nothing paid out to hedger");
        assertEq(_bal(dealer), 0, "nothing paid out to dealer");
    }

    /// SELL_USD: dealer called at 1.15; spot reverts to 1.10 after the deadline. Anyone closes out.
    function test_CloseOut_Cure_Dealer_ClearsCall_NoDefault() public {
        uint256 id = _called(Tenor.Side.SELL_USD, 1.15e8);
        // an intermediate mark that does not cure; closeOut 12s later must ignore markInterval (60s)
        vm.warp(T0 + 170);
        tenor.mark(id);
        (,,, uint8 cp, uint256 dl,) = tenor.health(id);
        assertEq(cp, 2);
        assertEq(dl, T0 + 181, "mark does not extend the deadline");

        vm.warp(T0 + 182);
        _setSpot(1.10e8);
        assertEq(_mtmHedger(id), int256(-1), "python literal: forward slightly below contract rate");
        uint256 fwd = _fair(1.10e8, 30 days - 182, RUSD, REUR);

        vm.expectEmit(true, false, false, true, address(tenor));
        emit Tenor.Marked(id, 1.10e8 * 1e10, fwd, -1, -454_545);
        vm.expectEmit(true, true, false, false, address(tenor));
        emit Tenor.MarginCured(id, dealer);
        vm.recordLogs();
        vm.prank(stranger);
        tenor.closeOut(id); // must not revert

        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(_count(logs, Tenor.ClosedOut.selector), 0, "no ClosedOut");
        assertEq(_count(logs, Tenor.ShortfallRecorded.selector), 0, "no shortfall");
        assertEq(_count(logs, Tenor.MarginCured.selector), 1, "MarginCured once");

        _assertStillOpenNoCall(id);
        Tenor.Trade memory t = tenor.getTrade(id);
        assertEq(t.hedgerMargin, 499_999, "margins as swept");
        assertEq(t.dealerMargin, 500_001, "margins as swept");
        assertEq(t.hedgerMargin + t.dealerMargin, 2 * IM);
        assertEq(t.lastMtmHedger, -1);
        assertEq(t.lastMarkAt, T0 + 182);

        // call is gone: second closeOut reverts; mark obeys the interval again
        vm.expectRevert(Tenor.NoMarginCall.selector);
        tenor.closeOut(id);
        vm.expectRevert(Tenor.MarkTooSoon.selector);
        tenor.mark(id);
    }

    /// Mirror: BUY_USD, EUR rallies => hedger called; reverts => hedger cured by closeOut.
    function test_CloseOut_Cure_Hedger_BuyUsd_ClearsCall_NoDefault() public {
        uint256 id = _called(Tenor.Side.BUY_USD, 1.15e8);
        (,,, uint8 cp,,) = tenor.health(id);
        assertEq(cp, 1, "hedger called");
        vm.warp(T0 + 182);
        _setSpot(1.10e8);
        assertEq(_mtmHedger(id), int256(1));

        vm.expectEmit(true, true, false, false, address(tenor));
        emit Tenor.MarginCured(id, hedger);
        vm.recordLogs();
        vm.prank(carol);
        tenor.closeOut(id);
        assertEq(_count(vm.getRecordedLogs(), Tenor.ClosedOut.selector), 0);

        _assertStillOpenNoCall(id);
        Tenor.Trade memory t = tenor.getTrade(id);
        assertEq(t.hedgerMargin, 500_001);
        assertEq(t.dealerMargin, 499_999);
        assertEq(t.lastMtmHedger, 1);
    }

    /// Margin exactly equal to initial margin counts as cured (>=).
    function test_CloseOut_Cure_ExactlyInitialMargin_Cures() public {
        uint256 id = _called(Tenor.Side.SELL_USD, 1.15e8);
        vm.warp(T0 + 182);
        _setSpot(1.1000001e8); // 110000010 => mtm 0 (python literal)
        assertEq(_mtmHedger(id), int256(0));
        tenor.closeOut(id);
        _assertStillOpenNoCall(id);
        Tenor.Trade memory t = tenor.getTrade(id);
        assertEq(t.dealerMargin, IM);
        assertEq(t.hedgerMargin, IM);
    }

    /// One unit below initial margin is NOT cured: normal default path.
    function test_CloseOut_Cure_OneBelowInitialMargin_Defaults() public {
        uint256 id = _called(Tenor.Side.SELL_USD, 1.15e8);
        vm.warp(T0 + 182);
        _setSpot(1.1000003e8); // 110000030 => mtm +1 (python literal)
        assertEq(_mtmHedger(id), int256(1));
        vm.expectEmit(true, true, false, true, address(tenor));
        emit Tenor.ClosedOut(id, dealer, 0, 499_999);
        tenor.closeOut(id);
        assertEq(uint8(tenor.getTrade(id).status), uint8(Tenor.Status.ClosedOut));
        assertEq(_bal(hedger), 500_001);
        assertEq(_bal(dealer), 499_999);
    }

    /// Partial recovery above maintenance (3%) but below initial (5%) still defaults.
    function test_CloseOut_PartialRecovery_AboveMaintenanceBelowInitial_Defaults() public {
        uint256 id = _called(Tenor.Side.SELL_USD, 1.15e8);
        vm.warp(T0 + 182);
        _setSpot(1.12e8);
        assertEq(_mtmHedger(id), int256(181_817), "python literal");
        vm.expectEmit(true, true, false, true, address(tenor));
        emit Tenor.ClosedOut(id, dealer, 0, 318_183);
        tenor.closeOut(id);
        assertEq(_bal(hedger), 681_817);
        assertEq(_bal(dealer), 318_183);
        assertEq(_bal(hedger) + _bal(dealer), 2 * IM);
    }

    function test_CloseOut_PartialRecovery_BuyUsd_HedgerDefaults() public {
        uint256 id = _called(Tenor.Side.BUY_USD, 1.15e8);
        vm.warp(T0 + 182);
        _setSpot(1.12e8);
        vm.expectEmit(true, true, false, true, address(tenor));
        emit Tenor.ClosedOut(id, hedger, 0, 318_183);
        tenor.closeOut(id);
        assertEq(_bal(hedger), 318_183);
        assertEq(_bal(dealer), 681_817);
    }

    /// Price keeps running against the called party: default path pays the swept VM in the event.
    function test_CloseOut_Default_AfterFreshSweep_PaidIncludesSweep() public {
        uint256 id = _called(Tenor.Side.SELL_USD, 1.15e8);
        vm.warp(T0 + 182);
        _setSpot(1.152e8);
        vm.recordLogs();
        tenor.closeOut(id);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(_count(logs, Tenor.Marked.selector), 1, "fresh sweep emitted Marked");
        assertEq(_count(logs, Tenor.ClosedOut.selector), 1);
        assertEq(_bal(hedger), 972_726);
        assertEq(_bal(dealer), 27_274);
    }

    /// Bad oracle at close-out: falls back to the last-marked MTM, no sweep, default settles.
    function test_CloseOut_BadOracle_FallsBackToLastMtm_Defaults() public {
        uint256 id = _called(Tenor.Side.SELL_USD, 1.15e8);
        vm.warp(T0 + 182);
        vm.prank(owner);
        feed.setAnswer(0);
        vm.expectEmit(true, true, false, true, address(tenor));
        emit Tenor.ClosedOut(id, dealer, 0, 45_455);
        vm.recordLogs();
        tenor.closeOut(id);
        assertEq(_count(vm.getRecordedLogs(), Tenor.Marked.selector), 0, "no sweep on bad oracle");
        assertEq(_bal(hedger), 954_545);
        assertEq(_bal(dealer), 45_455);
    }

    /// Stale oracle never cures: even if the price would have recovered, defaults on last mark.
    function test_CloseOut_StaleOracle_NoCure_Defaults() public {
        uint256 id = _called(Tenor.Side.SELL_USD, 1.15e8);
        vm.warp(T0 + 61 + 90_001);
        tenor.closeOut(id);
        assertEq(uint8(tenor.getTrade(id).status), uint8(Tenor.Status.ClosedOut));
        assertEq(_bal(hedger), 954_545);
        assertEq(_bal(dealer), 45_455);
    }

    /// After a closeOut cure the trade is fully live: a new adverse move raises a fresh call.
    function test_CloseOut_Cure_ThenNewCallCanBeRaised() public {
        uint256 id = _called(Tenor.Side.SELL_USD, 1.15e8);
        vm.warp(T0 + 182);
        _setSpot(1.10e8);
        tenor.closeOut(id);
        vm.warp(T0 + 182 + 61);
        _setSpot(1.15e8);
        vm.expectEmit(true, true, false, true, address(tenor));
        emit Tenor.MarginCalled(id, dealer, T0 + 182 + 61 + 120);
        tenor.mark(id);
        (,,, uint8 cp, uint256 dl,) = tenor.health(id);
        assertEq(cp, 2);
        assertEq(dl, T0 + 182 + 61 + 120);
    }

    /// Cured trade proceeds to settlement normally and conserves all USDC.
    function test_CloseOut_Cure_TradeStillSettlesAndConserves() public {
        uint256 id = _called(Tenor.Side.SELL_USD, 1.15e8);
        vm.warp(T0 + 182);
        _setSpot(1.10e8);
        tenor.closeOut(id);
        // no one funds legs => mutual cancellation after grace; VM unwound, margins returned
        vm.warp(T0 + 30 days + 120);
        _setSpot(1.10e8);
        tenor.settle(id);
        assertEq(uint8(tenor.getTrade(id).status), uint8(Tenor.Status.DeliveryFailed));
        assertEq(_bal(hedger), IM);
        assertEq(_bal(dealer), IM);
    }
}
