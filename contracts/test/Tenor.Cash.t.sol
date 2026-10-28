// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {TenorTestBase} from "./Tenor.Base.t.sol";
import {Tenor} from "../Tenor.sol";
import {MockBlocklistERC20} from "./mocks/MockBlocklistERC20.sol";

/// @dev Cash settlement (MTM difference only) and blocklist isolation.
contract TenorCashTest is TenorTestBase {
    uint256 internal constant MAT = T0 + 30 days;

    function _bal(address a) internal view returns (uint256) {
        return tenor.usdcBalance(a);
    }

    function _cashAtMaturity(Tenor.Side side, uint256 markSpot, uint256 finalSpot) internal returns (uint256 id) {
        id = _openTrade(side, true);
        if (markSpot != 0) {
            vm.warp(T0 + 61);
            _setSpot(markSpot);
            tenor.mark(id);
        }
        vm.warp(MAT);
        _setSpot(finalSpot);
    }

    function test_CashSettle_SellUsd_EurUp_NoPriorMark() public {
        uint256 id = _cashAtMaturity(Tenor.Side.SELL_USD, 0, 1.13e8);
        uint256 usdcBefore = usdc.balanceOf(address(tenor));
        vm.expectEmit(true, false, false, true, address(tenor));
        emit Tenor.CashSettled(id, 255_902, 255_902);
        vm.prank(stranger);
        tenor.settle(id);

        assertEq(_bal(hedger), IM + 255_902);
        assertEq(_bal(dealer), IM - 255_902);
        Tenor.Trade memory t = tenor.getTrade(id);
        assertEq(uint8(t.status), uint8(Tenor.Status.CashSettled));
        assertEq(t.hedgerMargin + t.dealerMargin, 0);
        // pure internal accounting: no principal, no EURC and no token moved at settlement
        assertEq(usdc.balanceOf(address(tenor)), usdcBefore);
        assertEq(eurc.balanceOf(address(tenor)), 0);
        assertEq(tenor.eurcBalance(hedger) + tenor.eurcBalance(dealer), 0);

        vm.prank(hedger);
        tenor.withdraw();
        vm.prank(dealer);
        tenor.withdraw();
        assertEq(usdc.balanceOf(hedger), IM + 255_902);
        assertEq(usdc.balanceOf(dealer), IM - 255_902);
        assertEq(usdc.balanceOf(address(tenor)), 0);
    }

    function test_CashSettle_AfterPriorMark_PaidIsOnlyTheIncrement() public {
        uint256 id = _cashAtMaturity(Tenor.Side.SELL_USD, 1.12e8, 1.13e8);
        assertEq(tenor.getTrade(id).lastMtmHedger, 181_817);
        vm.expectEmit(true, false, false, true, address(tenor));
        emit Tenor.CashSettled(id, 255_902, 255_902 - 181_817);
        tenor.settle(id);
        assertEq(_bal(hedger), IM + 255_902);
        assertEq(_bal(dealer), IM - 255_902);
    }

    function test_CashSettle_SellUsd_EurDown_HedgerPays() public {
        uint256 id = _cashAtMaturity(Tenor.Side.SELL_USD, 0, 1.08e8);
        vm.expectEmit(true, false, false, true, address(tenor));
        emit Tenor.CashSettled(id, -197_898, 197_898);
        tenor.settle(id);
        assertEq(_bal(hedger), IM - 197_898);
        assertEq(_bal(dealer), IM + 197_898);
    }

    function test_CashSettle_BuyUsd_EurDown_HedgerGains() public {
        uint256 id = _cashAtMaturity(Tenor.Side.BUY_USD, 0, 1.08e8);
        vm.expectEmit(true, false, false, true, address(tenor));
        emit Tenor.CashSettled(id, 197_898, 197_898);
        tenor.settle(id);
        assertEq(_bal(hedger), IM + 197_898);
        assertEq(_bal(dealer), IM - 197_898);
    }

    function test_CashSettle_BuyUsd_EurUp_HedgerPays() public {
        uint256 id = _cashAtMaturity(Tenor.Side.BUY_USD, 0, 1.13e8);
        tenor.settle(id);
        assertEq(_bal(hedger), IM - 255_902);
        assertEq(_bal(dealer), IM + 255_902);
    }

    function test_CashSettle_LoserMarginInsufficient_ShortfallRecorded() public {
        uint256 id = _cashAtMaturity(Tenor.Side.SELL_USD, 0, 2.0e8);
        vm.expectEmit(true, true, false, true, address(tenor));
        emit Tenor.ShortfallRecorded(id, dealer, 8_152_040 - 500_000);
        vm.expectEmit(true, false, false, true, address(tenor));
        emit Tenor.CashSettled(id, 8_152_040, 500_000);
        tenor.settle(id);
        assertEq(_bal(hedger), 2 * IM);
        assertEq(_bal(dealer), 0);
        assertEq(tenor.getTrade(id).dealerShortfall, 7_652_040);
    }

    function test_CashSettle_BeforeGrace_StaleFeedReverts_AfterGraceFallsBackToLastMtm() public {
        uint256 id = _cashAtMaturity(Tenor.Side.SELL_USD, 1.12e8, 1.12e8);
        // feed was last updated at MAT; 90_001s later it is stale AND we are past deliveryGrace
        vm.warp(MAT + 90_001);
        // past grace + stale: best-effort fallback to last marked VM (nothing further moves)
        vm.expectEmit(true, false, false, true, address(tenor));
        emit Tenor.CashSettled(id, 181_817, 0);
        tenor.settle(id);
        assertEq(_bal(hedger), IM + 181_817);
        assertEq(_bal(dealer), IM - 181_817);
    }

    function test_CashSettle_WithinGrace_StaleFeedReverts() public {
        uint256 id = _openTrade(Tenor.Side.SELL_USD, true);
        vm.warp(MAT); // feed last updated at T0: 30 days old => stale
        vm.expectRevert(Tenor.StalePrice.selector);
        tenor.settle(id);
        vm.prank(owner);
        feed.setAnswer(0);
        vm.expectRevert(Tenor.BadPrice.selector);
        tenor.settle(id);
    }

    // ------------------------------------- blocklist -------------------------------------

    function _openBobVsDealer2() internal returns (uint256 id) {
        Tenor.Quote memory q = _mkQuote(Tenor.Side.BUY_USD, N, 30 days, true);
        q.dealer = dealer2;
        _fund(bob, IM);
        _fund(dealer2, IM);
        bytes memory sig = _sign(dealer2Pk, q);
        vm.prank(bob);
        id = tenor.open(q, sig);
    }

    function test_Blocklist_USDC_RecipientKeepsCredit_OthersSettleAndWithdraw() public {
        uint256 id1 = _openTrade(Tenor.Side.SELL_USD, true); // hedger vs dealer
        uint256 id2 = _openBobVsDealer2(); // bob vs dealer2
        usdc.setBlocklisted(hedger, true);

        vm.warp(MAT);
        _setSpot(1.13e8);
        // settlement never touches tokens, so a blocklisted party cannot veto it
        tenor.settle(id1);
        tenor.settle(id2);
        uint256 hedgerCredit = _bal(hedger);
        assertEq(hedgerCredit, IM + 255_902);

        vm.expectRevert(abi.encodeWithSelector(MockBlocklistERC20.Blocklisted.selector, hedger));
        vm.prank(hedger);
        tenor.withdraw();
        vm.expectRevert(abi.encodeWithSelector(MockBlocklistERC20.Blocklisted.selector, hedger));
        vm.prank(hedger);
        tenor.withdrawMargin(1);
        assertEq(_bal(hedger), hedgerCredit, "credit preserved");
        assertEq(usdc.balanceOf(hedger), 0);

        // counterparties and unrelated users are unaffected
        vm.prank(dealer);
        tenor.withdraw();
        vm.prank(bob);
        tenor.withdraw();
        vm.prank(dealer2);
        tenor.withdraw();
        assertEq(usdc.balanceOf(dealer), IM - 255_902);
        assertEq(usdc.balanceOf(bob), IM - 255_902, "BUY_USD hedger loses when EUR rallies");
        assertEq(usdc.balanceOf(dealer2), IM + 255_902);
        assertEq(usdc.balanceOf(address(tenor)), hedgerCredit, "only the blocked credit remains");

        // lifting the blocklist releases the credit in full
        usdc.setBlocklisted(hedger, false);
        vm.prank(hedger);
        tenor.withdraw();
        assertEq(usdc.balanceOf(hedger), hedgerCredit);
        assertEq(usdc.balanceOf(address(tenor)), 0);
    }

    function test_Blocklist_EURC_RecipientKeepsEurcCredit_OthersFine() public {
        uint256 id = _openTrade(Tenor.Side.SELL_USD, false);
        vm.warp(MAT);
        _setSpot(SPOT);
        _wallet(hedger, N, 0);
        _wallet(dealer, 0, 9_076_020);
        vm.prank(hedger);
        tenor.fundLeg(id);
        vm.prank(dealer);
        tenor.fundLeg(id);
        eurc.setBlocklisted(hedger, true); // hedger will be credited EURC
        tenor.settle(id);
        assertEq(tenor.eurcBalance(hedger), 9_076_020);

        vm.expectRevert(abi.encodeWithSelector(MockBlocklistERC20.Blocklisted.selector, hedger));
        vm.prank(hedger);
        tenor.withdrawEurc();
        assertEq(tenor.eurcBalance(hedger), 9_076_020, "credit unchanged after failed withdraw");
        assertEq(eurc.balanceOf(address(tenor)), 9_076_020);

        // hedger's USDC side is unaffected (only EURC is blocklisted) and so is the dealer
        vm.prank(hedger);
        tenor.withdraw();
        vm.prank(dealer);
        tenor.withdraw();
        assertEq(usdc.balanceOf(dealer), N + IM);
        assertEq(usdc.balanceOf(hedger), IM);
    }

    function test_Blocklist_CannotFundLegOrDepositWhenBlocked() public {
        usdc.mint(carol, 1e6);
        usdc.setBlocklisted(carol, true);
        vm.startPrank(carol);
        usdc.approve(address(tenor), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(MockBlocklistERC20.Blocklisted.selector, carol));
        tenor.depositMargin(1e6);
        vm.stopPrank();
    }
}
