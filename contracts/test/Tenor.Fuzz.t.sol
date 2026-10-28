// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {TenorTestBase} from "./Tenor.Base.t.sol";
import {Tenor} from "../Tenor.sol";

/// @dev Stateless fuzz: quote/forward math ranges, open band, VM zero-sum, settlement exactness.
contract TenorFuzzTest is TenorTestBase {
    function _bal(address a) internal view returns (uint256) {
        return tenor.usdcBalance(a);
    }

    function testFuzz_QuoteMath_NoOverflow_MatchesReference(
        uint256 spot8, uint256 rU, uint256 rE, uint256 tenorSecs, uint256 notional
    ) public {
        spot8 = bound(spot8, 1, 1e12); // up to 10_000.00000000 USD per EUR
        rU = bound(rU, 0, 0.5e18);
        rE = bound(rE, 0, 0.5e18);
        tenorSecs = bound(tenorSecs, 0, 366 days);
        notional = bound(notional, 1, 50e6);
        vm.prank(owner);
        tenor.setRates(rU, rE);
        _setSpot(spot8);

        (uint256 spot, uint256 fair, uint256 lo, uint256 hi, uint256 im) = tenor.quote(notional, tenorSecs);
        assertEq(spot, spot8 * 1e10);
        assertEq(fair, _fair(spot8, tenorSecs, rU, rE), "matches independent CIP formula");
        uint256 exact = (spot8 * 1e10 * (YEAR * 1e18 + rU * tenorSecs)) / (YEAR * 1e18 + rE * tenorSecs);
        assertApproxEqAbs(fair, exact, 3 + (2 * fair) / 1e18, "within floor-rounding of exact rational CIP");
        uint256 band = (fair * 50) / 10_000;
        assertEq(lo, fair - band);
        assertEq(hi, fair + band);
        assertLe(lo, fair);
        assertGe(hi, fair);
        assertEq(im, _ceilBps(notional, 500));
        assertGe(im * 10_000, notional * 500, "margin never rounds down");
        assertLt((im - 1) * 10_000, notional * 500, "margin rounds up by < 1 unit");

        if (rU == rE) assertEq(fair, spot8 * 1e10, "no differential => forward == spot");
        else if (rU > rE) assertGe(fair, spot8 * 1e10, "USD rate higher => EUR at premium");
        else assertLe(fair, spot8 * 1e10, "EUR rate higher => EUR at discount");
    }

    function testFuzz_Forward_MonotoneInTenor(uint256 rU, uint256 rE, uint256 t1, uint256 t2) public {
        rU = bound(rU, 0, 0.5e18);
        rE = bound(rE, 0, rU); // premium regime
        t1 = bound(t1, 0, 366 days);
        t2 = bound(t2, t1, 366 days);
        vm.prank(owner);
        tenor.setRates(rU, rE);
        (, uint256 f1,,,) = tenor.quote(1e6, t1);
        (, uint256 f2,,,) = tenor.quote(1e6, t2);
        assertGe(f2 + 2, f1, "longer tenor never has a (materially) lower premium");
    }

    function testFuzz_Open_AnyRateInsideBandSucceeds(uint256 offsetBps, bool up, uint8 sideRaw, uint256 notional) public {
        offsetBps = bound(offsetBps, 0, 50);
        notional = bound(notional, 1e3, 50e6);
        Tenor.Side side = sideRaw % 2 == 0 ? Tenor.Side.SELL_USD : Tenor.Side.BUY_USD;
        Tenor.Quote memory q = _mkQuote(side, notional, 7 days, false);
        uint256 fair = q.rate;
        // offset <= band (50 bps) of fair, using the same flooring as the band itself
        uint256 delta = (fair * offsetBps) / 10_000;
        q.rate = up ? fair + delta : fair - delta;
        uint256 id = _openQuote(q);
        Tenor.Trade memory t = tenor.getTrade(id);
        assertEq(t.eurAmount6, (notional * 1e18) / q.rate);
        assertEq(t.hedgerMargin, _ceilBps(notional, 500));
        // value of the EUR leg at the contract rate never exceeds the USD notional (rounded down)
        assertLe((t.eurAmount6 * q.rate) / 1e18, notional);
    }

    function testFuzz_Mark_ZeroSum_AndClampedToMargin(uint8 sideRaw, uint256 notional, uint256 newSpot, uint256 dt) public {
        notional = bound(notional, 1e6, 50e6);
        newSpot = bound(newSpot, 0.3e8, 3e8);
        dt = bound(dt, 60, 29 days);
        Tenor.Side side = sideRaw % 2 == 0 ? Tenor.Side.SELL_USD : Tenor.Side.BUY_USD;
        uint256 id = _openQuote(_mkQuote(side, notional, 30 days, false));
        uint256 m = _ceilBps(notional, 500);
        uint256 tokenBefore = usdc.balanceOf(address(tenor));

        vm.warp(block.timestamp + dt);
        _setSpot(newSpot);
        int256 mtm = _mtmHedger(id);
        tenor.mark(id);

        Tenor.Trade memory t = tenor.getTrade(id);
        assertEq(t.hedgerMargin + t.dealerMargin, 2 * m, "VM is zero-sum");
        int256 moved = mtm;
        if (moved > int256(m)) moved = int256(m); // dealer can only pay what it posted
        if (moved < -int256(m)) moved = -int256(m);
        assertEq(int256(t.hedgerMargin), int256(m) + moved);
        assertEq(int256(t.dealerMargin), int256(m) - moved);
        assertEq(t.lastMtmHedger, moved, "lastMtm tracks actual movement");
        assertEq(usdc.balanceOf(address(tenor)), tokenBefore, "marking never moves tokens");
        // direction check: hedger long EUR gains iff the forward rose above the contract rate
        if (side == Tenor.Side.SELL_USD) assertEq(mtm >= 0, _fair(newSpot, 30 days - dt, RUSD, REUR) >= t.rate);
    }

    function testFuzz_CashSettle_ExactMtmAndConservation(uint8 sideRaw, uint256 notional, uint256 finalSpot) public {
        notional = bound(notional, 1e6, 50e6);
        finalSpot = bound(finalSpot, 0.2e8, 5e8);
        Tenor.Side side = sideRaw % 2 == 0 ? Tenor.Side.SELL_USD : Tenor.Side.BUY_USD;
        uint256 id = _openQuote(_mkQuote(side, notional, 30 days, true));
        uint256 m = _ceilBps(notional, 500);
        vm.warp(T0 + 30 days);
        _setSpot(finalSpot);
        int256 mtm = _mtmHedger(id); // remaining==0 => forward == spot
        tenor.settle(id);

        int256 moved = mtm > int256(m) ? int256(m) : (mtm < -int256(m) ? -int256(m) : mtm);
        assertEq(int256(_bal(hedger)), int256(m) + moved);
        assertEq(int256(_bal(dealer)), int256(m) - moved);
        assertEq(_bal(hedger) + _bal(dealer), 2 * m);
        assertEq(usdc.balanceOf(address(tenor)), 2 * m);
        uint256 owed = uint256(mtm >= 0 ? mtm : -mtm);
        uint256 shortfall = side == Tenor.Side.SELL_USD
            ? (mtm >= 0 ? tenor.getTrade(id).dealerShortfall : tenor.getTrade(id).hedgerShortfall)
            : (mtm >= 0 ? tenor.getTrade(id).dealerShortfall : tenor.getTrade(id).hedgerShortfall);
        uint256 cap = owed > m ? owed - m : 0;
        assertEq(shortfall, cap, "shortfall == MTM beyond the loser's posted margin");
    }

    function testFuzz_PhysicalDelivery_ExactAmounts(uint8 sideRaw, uint256 notional, uint256 offsetBps, bool up, uint256 finalSpot) public {
        notional = bound(notional, 1e3, 50e6);
        offsetBps = bound(offsetBps, 0, 50);
        finalSpot = bound(finalSpot, 0.3e8, 3e8);
        Tenor.Side side = sideRaw % 2 == 0 ? Tenor.Side.SELL_USD : Tenor.Side.BUY_USD;
        Tenor.Quote memory q = _mkQuote(side, notional, 30 days, false);
        q.rate = up ? q.rate + (q.rate * offsetBps) / 10_000 : q.rate - (q.rate * offsetBps) / 10_000;
        uint256 id = _openQuote(q);
        uint256 eurAmt = (notional * 1e18) / q.rate;
        uint256 m = _ceilBps(notional, 500);

        vm.warp(T0 + 30 days);
        _setSpot(finalSpot);
        (address usdSeller, address eurSeller) = side == Tenor.Side.SELL_USD ? (hedger, dealer) : (dealer, hedger);
        _wallet(usdSeller, notional, 0);
        _wallet(eurSeller, 0, eurAmt);
        vm.prank(usdSeller);
        tenor.fundLeg(id);
        vm.prank(eurSeller);
        tenor.fundLeg(id);
        tenor.settle(id);

        assertEq(tenor.eurcBalance(usdSeller), eurAmt);
        assertEq(_bal(eurSeller), notional + m);
        assertEq(_bal(usdSeller), m);
        assertEq(usdc.balanceOf(address(tenor)), 2 * m + notional);
        assertEq(eurc.balanceOf(address(tenor)), eurAmt);
    }
}
