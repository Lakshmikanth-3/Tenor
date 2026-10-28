// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {TenorTestBase} from "./Tenor.Base.t.sol";
import {Tenor} from "../Tenor.sol";

/// @dev Physical delivery, delivery failure, and settlement-state error paths.
contract TenorSettleTest is TenorTestBase {
    uint256 internal constant EUR_AMT = 9_076_020; // N / 1.101804511278195488, rounded down (python)
    uint256 internal constant MAT = T0 + 30 days;
    uint256 internal constant GRACE = 120;

    function _sellers(Tenor.Side side) internal view returns (address usdSeller, address eurSeller) {
        return side == Tenor.Side.SELL_USD ? (hedger, dealer) : (dealer, hedger);
    }

    function _bal(address a) internal view returns (uint256) {
        return tenor.usdcBalance(a);
    }

    /// Opens, optionally marks at T0+61, warps to maturity with a fresh feed at `finalSpot`.
    function _toMaturity(Tenor.Side side, uint256 markSpot, uint256 finalSpot) internal returns (uint256 id) {
        id = _openTrade(side, false);
        assertEq(tenor.getTrade(id).eurAmount6, EUR_AMT);
        if (markSpot != 0) {
            vm.warp(T0 + 61);
            _setSpot(markSpot);
            tenor.mark(id);
        }
        vm.warp(MAT);
        _setSpot(finalSpot);
    }

    function _fundBoth(uint256 id, Tenor.Side side) internal {
        (address usdSeller, address eurSeller) = _sellers(side);
        _wallet(usdSeller, N, 0);
        _wallet(eurSeller, 0, EUR_AMT);
        vm.expectEmit(true, true, false, true, address(tenor));
        emit Tenor.LegFunded(id, usdSeller, USDC_ADDR, N);
        vm.prank(usdSeller);
        tenor.fundLeg(id);
        vm.expectEmit(true, true, false, true, address(tenor));
        emit Tenor.LegFunded(id, eurSeller, address(eurc), EUR_AMT);
        vm.prank(eurSeller);
        tenor.fundLeg(id);
    }

    function _deliverAndCheck(Tenor.Side side, uint256 markSpot, int256 expVm) internal {
        uint256 id = _toMaturity(side, markSpot, markSpot == 0 ? SPOT : markSpot);
        (address usdSeller, address eurSeller) = _sellers(side);
        assertEq(tenor.getTrade(id).lastMtmHedger, expVm, "VM moved before delivery");
        _fundBoth(id, side);
        assertEq(usdc.balanceOf(address(tenor)), 2 * IM + N, "usd leg escrowed");
        assertEq(eurc.balanceOf(address(tenor)), EUR_AMT, "eur leg escrowed");

        vm.expectEmit(true, false, false, false, address(tenor));
        emit Tenor.Delivered(id);
        vm.prank(stranger);
        tenor.settle(id);

        Tenor.Trade memory t = tenor.getTrade(id);
        assertEq(uint8(t.status), uint8(Tenor.Status.Delivered));
        assertEq(t.hedgerMargin, 0);
        assertEq(t.dealerMargin, 0);
        assertEq(t.usdLegAmount, 0);
        assertEq(t.eurLegAmount, 0);
        // EUR-buyer receives the exact EURC, USD-buyer receives the exact USDC
        assertEq(tenor.eurcBalance(usdSeller), EUR_AMT, "EURC to the USD seller");
        assertEq(tenor.eurcBalance(eurSeller), 0);
        assertEq(_bal(eurSeller), N + IM, "USDC leg + initial margin (VM unwound)");
        assertEq(_bal(usdSeller), IM, "margin back to exactly the initial deposit");

        // everything is withdrawable and the contract ends empty
        vm.prank(usdSeller);
        tenor.withdrawEurc();
        vm.prank(usdSeller);
        tenor.withdraw();
        vm.prank(eurSeller);
        tenor.withdraw();
        assertEq(eurc.balanceOf(usdSeller), EUR_AMT);
        assertEq(usdc.balanceOf(usdSeller), IM);
        assertEq(usdc.balanceOf(eurSeller), N + IM);
        assertEq(usdc.balanceOf(address(tenor)), 0);
        assertEq(eurc.balanceOf(address(tenor)), 0);
    }

    function test_Deliver_SellUsd_NoMark() public {
        _deliverAndCheck(Tenor.Side.SELL_USD, 0, 0);
    }

    function test_Deliver_SellUsd_AfterEurUpMark_UnwindsVm() public {
        _deliverAndCheck(Tenor.Side.SELL_USD, 1.12e8, 181_817);
    }

    function test_Deliver_BuyUsd_AfterEurUpMark_UnwindsNegativeVm() public {
        _deliverAndCheck(Tenor.Side.BUY_USD, 1.12e8, -181_817);
    }

    function test_Deliver_BuyUsd_AfterEurDownMark() public {
        _deliverAndCheck(Tenor.Side.BUY_USD, 1.08e8, 181_818);
    }

    function test_Deliver_ClearsOpenMarginCall() public {
        uint256 id = _toMaturity(Tenor.Side.SELL_USD, 1.15e8, 1.15e8);
        assertEq(tenor.getTrade(id).callParty, 2);
        _fundBoth(id, Tenor.Side.SELL_USD);
        tenor.settle(id);
        Tenor.Trade memory t = tenor.getTrade(id);
        assertEq(t.callParty, 0);
        assertEq(t.callDeadline, 0);
        assertEq(_bal(hedger), IM);
        assertEq(_bal(dealer), N + IM);
    }

    // ------------------------------------ DeliveryFailed ------------------------------------

    function test_DeliveryFailed_DealerDidNotFund_HedgerRefundedPlusMtm() public {
        uint256 id = _toMaturity(Tenor.Side.SELL_USD, 0, SPOT);
        _wallet(hedger, N, 0);
        vm.prank(hedger);
        tenor.fundLeg(id); // only the hedger's USD leg

        vm.expectRevert(Tenor.LegUnfunded.selector);
        tenor.settle(id);
        vm.warp(MAT + GRACE - 1);
        vm.expectRevert(Tenor.LegUnfunded.selector);
        tenor.settle(id);

        vm.warp(MAT + GRACE);
        _setSpot(1.12e8);
        assertEq(_mtmHedger(id), int256(165_142), "python literal");
        vm.expectEmit(true, true, false, true, address(tenor));
        emit Tenor.DeliveryFailed(id, dealer, 165_142, 500_000 - 165_142);
        tenor.settle(id);

        assertEq(uint8(tenor.getTrade(id).status), uint8(Tenor.Status.DeliveryFailed));
        assertEq(_bal(hedger), N + IM + 165_142, "USD leg refunded + margin + MTM payout");
        assertEq(_bal(dealer), IM - 165_142);
        assertEq(tenor.eurcBalance(dealer), 0);
        assertEq(usdc.balanceOf(address(tenor)), _bal(hedger) + _bal(dealer));
    }

    function test_DeliveryFailed_HedgerDidNotFund_DealerRefundedPlusMtm() public {
        uint256 id = _toMaturity(Tenor.Side.SELL_USD, 0, SPOT);
        _wallet(dealer, 0, EUR_AMT);
        vm.prank(dealer);
        tenor.fundLeg(id); // dealer funds the EURC leg only

        vm.expectRevert(Tenor.LegUnfunded.selector);
        tenor.settle(id);
        vm.warp(MAT + GRACE);
        _setSpot(1.08e8); // EUR fell: hedger (long EUR) is in the red => dealer is owed MTM
        assertEq(_mtmHedger(id), int256(-197_898), "python literal");
        vm.expectEmit(true, true, false, true, address(tenor));
        emit Tenor.DeliveryFailed(id, hedger, 197_898, 500_000 - 197_898);
        tenor.settle(id);

        assertEq(tenor.eurcBalance(dealer), EUR_AMT, "EURC refunded to its funder");
        assertEq(_bal(dealer), IM + 197_898);
        assertEq(_bal(hedger), IM - 197_898);
        assertEq(eurc.balanceOf(address(tenor)), EUR_AMT);
    }

    function test_DeliveryFailed_BuyUsd_HedgerFundedEurc() public {
        uint256 id = _toMaturity(Tenor.Side.BUY_USD, 0, SPOT);
        _wallet(hedger, 0, EUR_AMT);
        vm.prank(hedger);
        tenor.fundLeg(id); // BUY_USD: hedger sells EUR
        vm.warp(MAT + GRACE);
        _setSpot(1.12e8); // EUR up: BUY_USD hedger (short EUR) loses, but dealer defaulted -> hedger entitled to max(mtm,0)=0
        tenor.settle(id);
        // hedger MTM is negative => floor at zero for the non-defaulter: nothing paid, margins returned as-is
        assertEq(tenor.eurcBalance(hedger), EUR_AMT);
        assertEq(_bal(hedger), IM);
        assertEq(_bal(dealer), IM);
    }

    function test_DeliveryFailed_NeitherFunded_MutualCancel_UnwindsVm() public {
        uint256 id = _toMaturity(Tenor.Side.SELL_USD, 1.12e8, 1.12e8);
        vm.expectRevert(Tenor.LegUnfunded.selector);
        tenor.settle(id);
        vm.warp(MAT + GRACE);
        vm.expectEmit(true, true, false, true, address(tenor));
        emit Tenor.DeliveryFailed(id, address(0), 0, 0);
        tenor.settle(id);
        assertEq(_bal(hedger), IM);
        assertEq(_bal(dealer), IM);
        assertEq(tenor.eurcBalance(hedger) + tenor.eurcBalance(dealer), 0);
    }

    // --------------------------------------- errors ---------------------------------------

    function test_Errors_NotMatured() public {
        uint256 id = _openTrade(Tenor.Side.SELL_USD, false);
        _wallet(hedger, N, 0);
        vm.expectRevert(Tenor.NotMatured.selector);
        vm.prank(hedger);
        tenor.fundLeg(id);
        vm.expectRevert(Tenor.NotMatured.selector);
        tenor.settle(id);
        vm.warp(MAT - 1);
        vm.expectRevert(Tenor.NotMatured.selector);
        tenor.settle(id);
    }

    function test_Errors_LegAlreadyFunded_BothSides() public {
        uint256 id = _toMaturity(Tenor.Side.SELL_USD, 0, SPOT);
        _wallet(hedger, 2 * N, 0);
        _wallet(dealer, 0, 2 * EUR_AMT);
        vm.startPrank(hedger);
        tenor.fundLeg(id);
        vm.expectRevert(Tenor.LegAlreadyFunded.selector);
        tenor.fundLeg(id);
        vm.stopPrank();
        vm.startPrank(dealer);
        tenor.fundLeg(id);
        vm.expectRevert(Tenor.LegAlreadyFunded.selector);
        tenor.fundLeg(id);
        vm.stopPrank();
    }

    function test_Errors_NotParty() public {
        uint256 id = _toMaturity(Tenor.Side.SELL_USD, 0, SPOT);
        _wallet(stranger, N, EUR_AMT);
        vm.expectRevert(Tenor.NotParty.selector);
        vm.prank(stranger);
        tenor.fundLeg(id);
        vm.expectRevert(Tenor.NotParty.selector);
        vm.prank(stranger);
        tenor.topUp(id, 1);
        vm.expectRevert(Tenor.NotParty.selector);
        vm.prank(stranger);
        tenor.withdrawExcess(id, 0);
    }

    function test_Errors_AlreadySettled_AfterDelivery() public {
        uint256 id = _toMaturity(Tenor.Side.SELL_USD, 0, SPOT);
        _fundBoth(id, Tenor.Side.SELL_USD);
        tenor.settle(id);
        vm.expectRevert(Tenor.AlreadySettled.selector);
        tenor.settle(id);
        vm.expectRevert(Tenor.AlreadySettled.selector);
        tenor.mark(id);
        vm.expectRevert(Tenor.AlreadySettled.selector);
        tenor.closeOut(id);
        vm.expectRevert(Tenor.AlreadySettled.selector);
        vm.prank(hedger);
        tenor.topUp(id, 1);
        vm.expectRevert(Tenor.AlreadySettled.selector);
        vm.prank(hedger);
        tenor.withdrawExcess(id, 0);
        vm.expectRevert(Tenor.AlreadySettled.selector);
        vm.prank(hedger);
        tenor.fundLeg(id);
    }

    function test_Errors_AlreadySettled_AfterDeliveryFailedAndCash() public {
        uint256 id = _toMaturity(Tenor.Side.SELL_USD, 0, SPOT);
        vm.warp(MAT + GRACE);
        tenor.settle(id); // neither funded => DeliveryFailed
        vm.expectRevert(Tenor.AlreadySettled.selector);
        tenor.settle(id);

        Tenor.Quote memory q = _mkQuote(Tenor.Side.SELL_USD, N, 30 days, true);
        uint256 cid = _openQuote(q);
        vm.warp(block.timestamp + 30 days);
        _setSpot(1.1e8);
        tenor.settle(cid);
        vm.expectRevert(Tenor.AlreadySettled.selector);
        tenor.settle(cid);
    }

    function test_Errors_NotPhysical_FundLegOnCashTrade() public {
        uint256 id = _openTrade(Tenor.Side.SELL_USD, true);
        vm.warp(MAT);
        vm.expectRevert(Tenor.NotPhysical.selector);
        vm.prank(hedger);
        tenor.fundLeg(id);
    }

    function test_Errors_TradeNotFound() public {
        vm.expectRevert(Tenor.TradeNotFound.selector);
        tenor.settle(1);
        vm.expectRevert(Tenor.TradeNotFound.selector);
        tenor.getTrade(0);
    }
}
