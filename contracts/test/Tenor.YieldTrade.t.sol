// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {TenorYieldBase} from "./Tenor.Yield.t.sol";
import {Tenor} from "../Tenor.sol";

/// @dev (4)+(5): locked margin is plain USDC; calls / cures / close-outs / settlement with both parties in yield mode.
contract TenorYieldTradeTest is TenorYieldBase {
    uint256 internal constant DEP = 1_000e6;

    function setUp() public override {
        super.setUp();
        _yFund(hedger, DEP);
        _yFund(dealer, DEP);
    }

    // ----------------------------------- helpers -----------------------------------

    function _open(Tenor.Side side, bool cash) internal returns (uint256 id) {
        Tenor.Quote memory q = _mkQuote(side, N, 30 days, cash);
        bytes memory sig = _sign(dealerPk, q);
        vm.prank(hedger);
        id = tenor.open(q, sig);
    }

    /// Opens SELL_USD physical and marks at T0+61 with `spot`; the called party's deadline is T0+181.
    function _called(Tenor.Side side, uint256 spot) internal returns (uint256 id) {
        id = _open(side, false);
        vm.warp(T0 + 61);
        _setSpot(spot);
        tenor.mark(id);
    }

    /// Exact conservation: Tenor's USDC == plain balances + trade margins + USD legs;
    /// vault shares held == totalVaultShares == shares of free margin only.
    function _assertAccounting() internal view {
        uint256 plain = tenor.usdcBalance(hedger) + tenor.usdcBalance(dealer);
        uint256 locked;
        for (uint256 id = 1; id < tenor.nextTradeId(); ++id) {
            Tenor.Trade memory t = tenor.getTrade(id);
            locked += t.hedgerMargin + t.dealerMargin + t.usdLegAmount;
        }
        assertEq(usdc.balanceOf(address(tenor)), plain + locked, "USDC held == plain + locked + legs");
        assertEq(vault.balanceOf(address(tenor)), tenor.totalVaultShares(), "vault shares held == total");
        assertEq(
            tenor.totalVaultShares(), tenor.vaultShares(hedger) + tenor.vaultShares(dealer), "total == free shares"
        );
    }

    // ------------------------------ (4) locked margin ------------------------------

    function test_Open_RedeemsOnlyTheMarginAndLocksPlainUsdc() public {
        uint256 id = _open(Tenor.Side.SELL_USD, false);
        Tenor.Trade memory t = tenor.getTrade(id);
        assertEq(t.hedgerMargin, IM);
        assertEq(t.dealerMargin, IM);
        assertEq(tenor.vaultShares(hedger), DEP - IM, "only IM left the vault");
        assertEq(tenor.vaultShares(dealer), DEP - IM);
        assertEq(tenor.usdcBalance(hedger), 0, "no leftover plain at par");
        assertEq(usdc.balanceOf(address(tenor)), 2 * IM, "Tenor holds exactly the two locked margins");
        assertEq(vault.balanceOf(address(tenor)), 2 * (DEP - IM));
        _assertAccounting();
    }

    function test_Open_LockedMarginNeverInVault_AfterYieldAccrued() public {
        skip(30 days);
        _setSpot(SPOT);
        uint256 id = _open(Tenor.Side.BUY_USD, true);
        Tenor.Trade memory t = tenor.getTrade(id);
        assertEq(t.hedgerMargin, IM);
        // plain USDC held covers margins and any rounding dust only; the rest is in the vault
        assertEq(
            usdc.balanceOf(address(tenor)),
            tenor.usdcBalance(hedger) + tenor.usdcBalance(dealer) + t.hedgerMargin + t.dealerMargin
        );
        assertLe(tenor.usdcBalance(hedger), 2, "rounding dust only");
        // free margin still earned: ~DEP*(1+0.045*30/365) - IM
        uint256 expected = DEP + DEP * 450 * 30 days / (365 days * 10_000) - IM;
        assertApproxEqAbs(tenor.freeMarginOf(hedger), expected, 4);
        assertGt(tenor.yieldEarned(hedger), 3e6, "yield kept accruing on the free part");
        _assertAccounting();
    }

    function test_Open_UsesPlainBeforeVault() public {
        _pause(true);
        _deposit(hedger, IM);
        _deposit(dealer, IM);
        _pause(false);
        uint256 redeemsBefore = vault.redeemCalls();
        _open(Tenor.Side.SELL_USD, false);
        assertEq(vault.redeemCalls(), redeemsBefore, "plain covered it");
        assertEq(tenor.vaultShares(hedger), DEP);
        _assertAccounting();
    }

    function test_Open_ShortOnFreeMarginReverts() public {
        // dealer withdraws nearly everything; hedger too little in total
        vm.prank(dealer);
        tenor.withdraw();
        _yFund(dealer, IM - 1);
        Tenor.Quote memory q = _mkQuote(Tenor.Side.SELL_USD, N, 30 days, false);
        bytes memory sig = _sign(dealerPk, q);
        vm.prank(hedger);
        vm.expectRevert(Tenor.InsufficientMargin.selector);
        tenor.open(q, sig);
        assertEq(tenor.nextTradeId(), 1, "no trade created");
        assertEq(tenor.vaultShares(hedger), DEP, "hedger redemption rolled back");
        _assertAccounting();
    }

    function test_Mark_MovesVmOnlyInsideTradeMargins() public {
        uint256 id = _called(Tenor.Side.SELL_USD, 1.15e8);
        Tenor.Trade memory t = tenor.getTrade(id);
        assertEq(t.hedgerMargin + t.dealerMargin, 2 * IM, "VM zero-sum");
        assertGt(t.hedgerMargin, IM);
        assertEq(t.callParty, 2, "dealer called");
        assertEq(tenor.vaultShares(hedger), DEP - IM, "vault untouched by mark");
        assertEq(tenor.vaultShares(dealer), DEP - IM);
        _assertAccounting();
    }

    // ------------------------------ (5) calls and cures ------------------------------

    function test_TopUp_CuresMarginCallByRedeemingShares() public {
        uint256 id = _called(Tenor.Side.SELL_USD, 1.15e8);
        uint256 sharesBefore = tenor.vaultShares(dealer);
        assertEq(tenor.usdcBalance(dealer), 0, "dealer has no plain: must redeem");

        vm.expectEmit(true, true, false, false, address(tenor));
        emit Tenor.MarginCured(id, dealer);
        vm.prank(dealer);
        tenor.topUp(id, 500_000);

        (uint256 hm, uint256 dm,, uint8 cp, uint256 dl,) = tenor.health(id);
        assertEq(cp, 0, "cured");
        assertEq(dl, 0);
        assertGe(dm, IM, "back to initial margin");
        assertEq(hm + dm, 2 * IM + 500_000, "top-up joined the locked margin");
        assertApproxEqAbs(sharesBefore - tenor.vaultShares(dealer), 500_000, 2, "paid for by shares");
        assertLe(tenor.usdcBalance(dealer), 2);
        _assertAccounting();
        // cured call cannot be closed out
        vm.warp(T0 + 200);
        vm.expectRevert(Tenor.NoMarginCall.selector);
        tenor.closeOut(id);
    }

    function test_TopUp_MoreThanFreeMarginReverts() public {
        uint256 id = _called(Tenor.Side.SELL_USD, 1.15e8);
        vm.prank(dealer);
        vm.expectRevert(Tenor.InsufficientMargin.selector);
        tenor.topUp(id, DEP); // only DEP - IM free
        assertEq(tenor.vaultShares(dealer), DEP - IM, "rolled back");
    }

    function test_TopUp_AfterYieldAccrued_StillCures() public {
        // dealer's margin is partly yield; cure still works
        skip(10 days);
        _setSpot(SPOT);
        uint256 id = _open(Tenor.Side.SELL_USD, false);
        vm.warp(block.timestamp + 61);
        _setSpot(1.15e8);
        tenor.mark(id);
        (,,, uint8 cp,,) = tenor.health(id);
        assertEq(cp, 2);
        vm.prank(dealer);
        tenor.topUp(id, 600_000);
        (,,, cp,,) = tenor.health(id);
        assertEq(cp, 0);
        _assertAccounting();
    }

    function test_CloseOut_BothInYieldMode_PaysPlainAndLeavesSharesAlone() public {
        uint256 id = _called(Tenor.Side.SELL_USD, 1.15e8);
        uint256 hs = tenor.vaultShares(hedger);
        uint256 ds = tenor.vaultShares(dealer);
        uint256 depositCallsBefore = vault.depositCalls();
        vm.warp(T0 + 182);

        vm.prank(stranger);
        tenor.closeOut(id);

        assertEq(uint8(tenor.getTrade(id).status), uint8(Tenor.Status.ClosedOut));
        assertEq(tenor.usdcBalance(hedger) + tenor.usdcBalance(dealer), 2 * IM, "all locked margin released as plain");
        assertGt(tenor.usdcBalance(hedger), IM + 400_000, "hedger got the VM");
        assertLt(tenor.usdcBalance(dealer), IM - 400_000);
        assertEq(tenor.vaultShares(hedger), hs, "closeOut never touches shares");
        assertEq(tenor.vaultShares(dealer), ds);
        assertEq(vault.depositCalls(), depositCallsBefore, "proceeds are not auto-deposited");
        _assertAccounting();

        // proceeds can be swept into yield explicitly (self-only)
        uint256 plain = tenor.usdcBalance(hedger);
        vm.prank(hedger);
        tenor.sweepToYield();
        assertEq(tenor.usdcBalance(hedger), 0);
        assertApproxEqAbs(tenor.freeMarginOf(hedger), hs + plain, 300, "plus ~182s of accrued yield");
        _assertAccounting();
    }

    function test_CloseOut_ThenWithdrawAll_PaysPlainPlusVaultValue() public {
        uint256 id = _called(Tenor.Side.SELL_USD, 1.15e8);
        vm.warp(T0 + 182);
        tenor.closeOut(id);
        uint256 free = tenor.freeMarginOf(hedger);
        assertGt(free, DEP + 400_000, "deposit plus VM won");
        uint256 got = _withdrawAll(hedger);
        assertApproxEqAbs(got, free, 1, "pays plain + vault value");
        assertEq(tenor.freeMarginOf(hedger), 0);
        assertEq(tenor.vaultShares(hedger), 0);
        _assertAccounting();
    }

    // ------------------------------ settlement stays plain ------------------------------

    function test_Settle_Physical_ProceedsStayPlain() public {
        uint256 id = _open(Tenor.Side.SELL_USD, false);
        Tenor.Trade memory t = tenor.getTrade(id);
        vm.warp(t.maturity);
        _setSpot(SPOT);
        _wallet(hedger, N, 0); // hedger sells USD
        _wallet(dealer, 0, t.eurAmount6); // dealer sells EUR
        vm.prank(hedger);
        tenor.fundLeg(id);
        vm.prank(dealer);
        tenor.fundLeg(id);
        // legs are plain USDC/EURC held by Tenor, never vault shares
        assertEq(usdc.balanceOf(address(tenor)), 2 * IM + N);
        _assertAccounting();

        uint256 depositCalls = vault.depositCalls();
        uint256 redeemCalls = vault.redeemCalls();
        tenor.settle(id);

        assertEq(uint8(tenor.getTrade(id).status), uint8(Tenor.Status.Delivered));
        assertEq(vault.depositCalls(), depositCalls, "no vault deposit during settlement");
        assertEq(vault.redeemCalls(), redeemCalls, "no vault redemption during settlement");
        assertGe(tenor.usdcBalance(dealer), N, "USD leg credited plain to the EUR seller");
        assertEq(tenor.eurcBalance(hedger), t.eurAmount6);
        assertGt(tenor.yieldEarned(hedger), 0);
        _assertAccounting();

        // opt-in sweep afterwards puts the proceeds to work
        vm.prank(dealer);
        tenor.sweepToYield();
        assertEq(tenor.usdcBalance(dealer), 0);
        _assertAccounting();
    }

    function test_Settle_Physical_FailedDelivery_AfterGrace() public {
        uint256 id = _open(Tenor.Side.SELL_USD, false);
        Tenor.Trade memory t = tenor.getTrade(id);
        vm.warp(t.maturity + 121);
        _setSpot(SPOT);
        _wallet(hedger, N, 0);
        vm.prank(hedger);
        tenor.fundLeg(id); // only the USD leg is funded: dealer defaults
        tenor.settle(id);
        assertEq(uint8(tenor.getTrade(id).status), uint8(Tenor.Status.DeliveryFailed));
        assertGe(tenor.usdcBalance(hedger), N, "hedger's USD leg refunded as plain");
        _assertAccounting();
    }

    function test_Settle_Cash_ProceedsStayPlain() public {
        uint256 id = _open(Tenor.Side.SELL_USD, true);
        Tenor.Trade memory t = tenor.getTrade(id);
        vm.warp(t.maturity);
        _setSpot(1.20e8);
        uint256 redeemCalls = vault.redeemCalls();
        uint256 depositCalls = vault.depositCalls();
        tenor.settle(id);
        assertEq(uint8(tenor.getTrade(id).status), uint8(Tenor.Status.CashSettled));
        assertEq(tenor.usdcBalance(hedger) + tenor.usdcBalance(dealer), 2 * IM);
        assertGt(tenor.usdcBalance(hedger), tenor.usdcBalance(dealer));
        assertEq(vault.redeemCalls(), redeemCalls);
        assertEq(vault.depositCalls(), depositCalls);
        _assertAccounting();
    }

    function test_WithdrawExcess_ReturnsPlain() public {
        uint256 id = _open(Tenor.Side.SELL_USD, true);
        vm.prank(hedger);
        tenor.topUp(id, 1e6); // pulled from shares
        assertEq(tenor.getTrade(id).hedgerMargin, IM + 1e6);
        vm.prank(hedger);
        tenor.withdrawExcess(id, 1e6);
        assertApproxEqAbs(tenor.usdcBalance(hedger), 1e6, 2, "excess comes back plain");
        _assertAccounting();
    }
}
