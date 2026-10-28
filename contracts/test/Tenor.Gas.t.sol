// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {console2} from "forge-std/Test.sol";
import {TenorTestBase} from "./Tenor.Base.t.sol";
import {Tenor} from "../Tenor.sol";

/// @dev Per-call gas measurements (gasleft delta around a single external call; warm-ish, cold storage as in a fresh tx).
contract TenorGasTest is TenorTestBase {
    uint256 internal constant EUR_AMT = 9_076_020;

    function test_Gas_Open_Mark_CloseOut() public {
        Tenor.Quote memory q = _mkQuote(Tenor.Side.SELL_USD, N, 30 days, false);
        _fund(hedger, IM);
        _fund(dealer, IM);
        bytes memory sig = _sign(dealerPk, q);
        vm.startPrank(hedger);
        uint256 g = gasleft();
        uint256 id = tenor.open(q, sig);
        g -= gasleft();
        vm.stopPrank();
        console2.log("GAS open (first trade, fresh slots)", g);
        assertLt(g, 600_000);

        vm.warp(T0 + 61);
        _setSpot(1.12e8);
        g = gasleft();
        tenor.mark(id);
        g -= gasleft();
        console2.log("GAS mark (first VM move, no call)", g);
        assertLt(g, 200_000);

        vm.warp(T0 + 122);
        _setSpot(1.15e8);
        g = gasleft();
        tenor.mark(id);
        g -= gasleft();
        console2.log("GAS mark (raises margin call)", g);

        vm.warp(T0 + 122 + 121);
        g = gasleft();
        tenor.closeOut(id);
        g -= gasleft();
        console2.log("GAS closeOut (dealer default)", g);
        assertLt(g, 300_000);
    }

    function test_Gas_Settle_Physical_Cash_Failed() public {
        // physical delivery
        uint256 id = _openTrade(Tenor.Side.SELL_USD, false);
        vm.warp(T0 + 30 days);
        _setSpot(SPOT);
        _wallet(hedger, N, 0);
        _wallet(dealer, 0, EUR_AMT);
        uint256 g = gasleft();
        vm.prank(hedger);
        tenor.fundLeg(id);
        g -= gasleft();
        console2.log("GAS fundLeg (first leg)", g);
        vm.prank(dealer);
        tenor.fundLeg(id);
        g = gasleft();
        tenor.settle(id);
        g -= gasleft();
        console2.log("GAS settle physical delivered", g);
        assertLt(g, 200_000);

        // cash
        Tenor.Quote memory q = _mkQuote(Tenor.Side.SELL_USD, N, 30 days, true);
        uint256 cid = _openQuote(q);
        vm.warp(block.timestamp + 30 days);
        _setSpot(1.13e8);
        g = gasleft();
        tenor.settle(cid);
        g -= gasleft();
        console2.log("GAS settle cash", g);
        assertLt(g, 200_000);

        // delivery failed (one leg funded)
        Tenor.Quote memory q2 = _mkQuote(Tenor.Side.SELL_USD, N, 30 days, false);
        uint256 fid = _openQuote(q2);
        vm.warp(block.timestamp + 30 days);
        _setSpot(1.14e8);
        _wallet(hedger, N, 0);
        vm.prank(hedger);
        tenor.fundLeg(fid);
        vm.warp(block.timestamp + 120);
        _setSpot(1.14e8);
        g = gasleft();
        tenor.settle(fid);
        g -= gasleft();
        console2.log("GAS settle delivery-failed", g);
        assertLt(g, 250_000);
    }

    function test_Gas_CloseOut_Cure() public {
        uint256 id = _openTrade(Tenor.Side.SELL_USD, false);
        vm.warp(T0 + 61);
        _setSpot(1.15e8);
        tenor.mark(id);
        vm.warp(T0 + 182);
        _setSpot(1.10e8);
        uint256 g = gasleft();
        tenor.closeOut(id);
        g -= gasleft();
        console2.log("GAS closeOut (cured, no default)", g);
        assertLt(g, 300_000);
        assertEq(uint8(tenor.getTrade(id).status), uint8(Tenor.Status.Open));
    }
}
