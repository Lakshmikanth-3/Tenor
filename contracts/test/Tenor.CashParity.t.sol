// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {TenorTestBase} from "./Tenor.Base.t.sol";
import {Tenor} from "../Tenor.sol";

/// @dev At maturity, cash settlement must equal the USD value difference of the physically delivered
/// EURC: (notional/rate EUR valued at spot) - notional, for the EUR buyer, negated for the EUR seller.
contract TenorCashParityTest is TenorTestBase {
    uint256 internal constant MAT = T0 + 30 days;

    function _bal(address a) internal view returns (uint256) {
        return tenor.usdcBalance(a);
    }

    /// Opens a physical and a cash trade with identical terms, settles both at maturity spot
    /// `finalSpot`, and returns the hedger's net economic result (USD6) under each mode.
    function _both(Tenor.Side side, uint256 finalSpot, uint256 notional)
        internal returns (int256 physical, int256 cash, uint256 eurAmt)
    {
        uint256 idP = _openQuote(_mkQuote(side, notional, 30 days, false));
        uint256 idC = _openQuote(_mkQuote(side, notional, 30 days, true));
        eurAmt = tenor.getTrade(idP).eurAmount6;
        assertEq(tenor.getTrade(idP).rate, tenor.getTrade(idC).rate);
        vm.warp(MAT);
        _setSpot(finalSpot);

        cash = _settleCash(idC);
        physical = _settlePhysical(idP, side, finalSpot, eurAmt);
        // all USDC accounted for: two trades' margins plus the physical USD leg
        assertEq(_bal(hedger) + _bal(dealer), 4 * _ceilBps(notional, 500) + notional, "USDC conserved");
    }

    function _settleCash(uint256 idC) internal returns (int256) {
        uint256 m = _ceilBps(tenor.getTrade(idC).notionalUsd6, 500);
        uint256 h0 = _bal(hedger);
        uint256 d0 = _bal(dealer);
        tenor.settle(idC);
        int256 h = int256(_bal(hedger)) - int256(h0) - int256(m);
        int256 d = int256(_bal(dealer)) - int256(d0) - int256(m);
        assertEq(h, -d, "cash VM is zero-sum");
        return h;
    }

    function _settlePhysical(uint256 idP, Tenor.Side side, uint256 finalSpot, uint256 eurAmt)
        internal returns (int256)
    {
        uint256 notional = tenor.getTrade(idP).notionalUsd6;
        (address usdSeller, address eurSeller) = side == Tenor.Side.SELL_USD ? (hedger, dealer) : (dealer, hedger);
        _wallet(usdSeller, notional, 0);
        _wallet(eurSeller, 0, eurAmt);
        vm.prank(usdSeller);
        tenor.fundLeg(idP);
        vm.prank(eurSeller);
        tenor.fundLeg(idP);
        tenor.settle(idP);
        assertEq(tenor.eurcBalance(usdSeller), eurAmt, "USD seller receives the full EURC principal");
        // USD value of the delivered EURC at spot, minus the USD paid for it
        int256 eurValue = int256((eurAmt * finalSpot * 1e10) / 1e18);
        int256 buyerResult = eurValue - int256(notional);
        return side == Tenor.Side.SELL_USD ? buyerResult : -buyerResult;
    }

    function _assertParity(Tenor.Side side, uint256 finalSpot, int256 expectedCash) internal {
        (int256 physical, int256 cash, uint256 eurAmt) = _both(side, finalSpot, N);
        assertEq(cash, expectedCash, "cash settlement == python literal");
        assertEq(eurAmt, 9_076_020);
        // EURC principal is floored to 6dp, so valuations differ by at most one EURC unit of value
        // (<= spot USD6 per unit, rounded up) plus the floor of the MTM itself.
        uint256 tol = finalSpot / 1e8 + 2;
        int256 diff = physical - cash;
        if (diff < 0) diff = -diff;
        assertLe(uint256(diff), tol, "cash == USD value difference of delivered EURC");
    }

    function test_Parity_SellUsd_EurUp() public {
        // hedger buys EUR forward: gains when EUR rises. 9076020*1.13 - 10e6; python mtm 255902.
        _assertParity(Tenor.Side.SELL_USD, 1.13e8, 255_902);
    }

    function test_Parity_SellUsd_EurDown() public {
        _assertParity(Tenor.Side.SELL_USD, 1.08e8, -197_898);
    }

    function test_Parity_BuyUsd_EurUp() public {
        _assertParity(Tenor.Side.BUY_USD, 1.13e8, -255_902);
    }

    function test_Parity_BuyUsd_EurDown() public {
        _assertParity(Tenor.Side.BUY_USD, 1.08e8, 197_898);
    }

    /// Spot exactly at the contract rate's neighbourhood: a tiny EUR move gives a tiny, correctly signed result.
    function test_Parity_SpotEqualsRate_ZeroNetOfRounding() public {
        // rate 1.101804511...; spot 1.1018045 (8dp) is 1.1e-8 below it => mtm magnitude 0.
        (int256 physical, int256 cash,) = _both(Tenor.Side.SELL_USD, 1.1018045e8, N);
        assertEq(cash, 0);
        assertLe(uint256(physical < 0 ? -physical : physical), 3);
    }

    function testFuzz_Parity_CashEqualsDeliveredEurcValueDifference(uint8 sideRaw, uint256 notional, uint256 finalSpot)
        public
    {
        notional = bound(notional, 1e6, 50e6);
        finalSpot = bound(finalSpot, 1.06e8, 1.14e8); // |VM| < 4.5% of notional: inside the 5% initial margin
        Tenor.Side side = sideRaw % 2 == 0 ? Tenor.Side.SELL_USD : Tenor.Side.BUY_USD;
        (int256 physical, int256 cash, uint256 eurAmt) = _both(side, finalSpot, notional);
        // independent: exact rational value difference N*(S-R)/R, sign by side, floored in magnitude
        Tenor.Trade memory t = tenor.getTrade(1);
        uint256 s18 = finalSpot * 1e10;
        uint256 mag = s18 >= t.rate ? (notional * (s18 - t.rate)) / t.rate : (notional * (t.rate - s18)) / t.rate;
        bool pos = (s18 >= t.rate) == (side == Tenor.Side.SELL_USD);
        assertEq(cash, pos ? int256(mag) : -int256(mag), "cash == floor(N*(S-R)/R) with side sign");
        int256 diff = physical - cash;
        if (diff < 0) diff = -diff;
        assertLe(uint256(diff), finalSpot / 1e8 + 2, "within rounding of delivered-EURC value difference");
        assertGt(eurAmt, 0);
    }
}
