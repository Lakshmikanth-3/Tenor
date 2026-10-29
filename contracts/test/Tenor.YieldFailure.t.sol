// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TenorYieldBase} from "./Tenor.Yield.t.sol";
import {Tenor} from "../Tenor.sol";
import {IYieldVault} from "../interfaces/IYieldVault.sol";

/// @dev Hostile vault whose deposit() mis-handles the pull in a configurable way.
contract MismatchVault is IYieldVault {
    address internal constant USDC = 0x3600000000000000000000000000000000000000;

    enum Mode { PullLess, PullNothing, ZeroShares, GiveTokensBack }

    Mode public mode;

    function setMode(Mode m) external {
        mode = m;
    }

    function asset() external pure returns (address) {
        return USDC;
    }

    function deposit(uint256 assets, address) external returns (uint256) {
        if (mode == Mode.PullLess) {
            IERC20(USDC).transferFrom(msg.sender, address(this), assets - 1);
            return assets;
        }
        if (mode == Mode.PullNothing) return assets;
        if (mode == Mode.ZeroShares) {
            IERC20(USDC).transferFrom(msg.sender, address(this), assets);
            return 0;
        }
        // GiveTokensBack: Tenor ends up with MORE USDC than before the call
        IERC20(USDC).transfer(msg.sender, 1);
        return assets;
    }

    function redeem(uint256, address, address) external pure returns (uint256) {
        revert("no redeem");
    }

    function convertToAssets(uint256 shares) external pure returns (uint256) {
        return shares;
    }

    function convertToShares(uint256 assets) external pure returns (uint256) {
        return assets;
    }
}

/// @dev (6)+(8): a failing / insolvent vault can never freeze trade lifecycle; hostile vault accounting.
contract TenorYieldFailureTest is TenorYieldBase {
    uint256 internal constant DEP = 1_000e6;
    uint256 internal drained;
    uint256 internal valueAtBreak;

    function setUp() public override {
        super.setUp();
        _yFund(hedger, DEP);
        _yFund(dealer, DEP);
    }

    // ----------------------------------- helpers -----------------------------------

    /// kind 0: deposit+redeem revert (quotes ok); 1: reserve drained so redeem reverts inside the token;
    /// 2: everything incl. quotes revert.
    function _break(uint256 kind) internal {
        if (kind == 0) {
            vault.setFaults(true, true, false);
        } else if (kind == 1) {
            drained = usdc.balanceOf(address(vault));
            vm.prank(address(vault));
            usdc.transfer(stranger, drained);
            assertGt(vault.reserveShortfall(), 0, "vault is now underfunded");
        } else {
            vault.setFaults(true, true, true);
        }
    }

    function _repair(uint256 kind) internal {
        if (kind == 1) {
            vm.prank(stranger);
            usdc.transfer(address(vault), drained);
        } else {
            vault.setFaults(false, false, false);
        }
    }

    function _open(bool cash) internal returns (uint256 id) {
        Tenor.Quote memory q = _mkQuote(Tenor.Side.SELL_USD, N, 30 days, cash);
        bytes memory sig = _sign(dealerPk, q);
        vm.prank(hedger);
        id = tenor.open(q, sig);
    }

    function _accounting() internal view {
        uint256 plain = tenor.usdcBalance(hedger) + tenor.usdcBalance(dealer);
        uint256 locked;
        for (uint256 id = 1; id < tenor.nextTradeId(); ++id) {
            Tenor.Trade memory t = tenor.getTrade(id);
            locked += t.hedgerMargin + t.dealerMargin + t.usdLegAmount;
        }
        assertEq(usdc.balanceOf(address(tenor)), plain + locked, "USDC conservation");
        assertEq(vault.balanceOf(address(tenor)), tenor.totalVaultShares());
        assertEq(tenor.totalVaultShares(), tenor.vaultShares(hedger) + tenor.vaultShares(dealer));
    }

    // --------------------- mark / closeOut / settle unaffected by the vault ---------------------

    function _scenarioMark(uint256 kind) internal {
        uint256 id = _open(false);
        _break(kind);
        vm.warp(T0 + 61);
        _setSpot(1.15e8);
        tenor.mark(id);
        (,,, uint8 cp,,) = tenor.health(id);
        assertEq(cp, 2, "margin call raised while vault is down");
        _accounting();
    }

    function _scenarioCloseOut(uint256 kind) internal {
        uint256 id = _open(false);
        vm.warp(T0 + 61);
        _setSpot(1.15e8);
        tenor.mark(id);
        _break(kind);
        vm.warp(T0 + 182);
        vm.prank(stranger);
        tenor.closeOut(id);
        assertEq(uint8(tenor.getTrade(id).status), uint8(Tenor.Status.ClosedOut));
        assertEq(tenor.usdcBalance(hedger) + tenor.usdcBalance(dealer), 2 * IM);
        _accounting();
    }

    function _scenarioSettlePhysical(uint256 kind) internal {
        uint256 id = _open(false);
        Tenor.Trade memory t = tenor.getTrade(id);
        _break(kind);
        vm.warp(t.maturity);
        _setSpot(SPOT);
        _wallet(hedger, N, 0);
        _wallet(dealer, 0, t.eurAmount6);
        vm.prank(hedger);
        tenor.fundLeg(id);
        vm.prank(dealer);
        tenor.fundLeg(id);
        tenor.settle(id);
        assertEq(uint8(tenor.getTrade(id).status), uint8(Tenor.Status.Delivered));
        assertGe(tenor.usdcBalance(dealer), N);
        _accounting();
    }

    function _scenarioSettleCash(uint256 kind) internal {
        uint256 id = _open(true);
        Tenor.Trade memory t = tenor.getTrade(id);
        _break(kind);
        vm.warp(t.maturity);
        _setSpot(1.20e8);
        tenor.settle(id);
        assertEq(uint8(tenor.getTrade(id).status), uint8(Tenor.Status.CashSettled));
        assertEq(tenor.usdcBalance(hedger) + tenor.usdcBalance(dealer), 2 * IM);
        _accounting();
    }

    function test_Mark_VaultReverting() public { _scenarioMark(0); }
    function test_Mark_VaultDrained() public { _scenarioMark(1); }
    function test_Mark_VaultQuotesDown() public { _scenarioMark(2); }
    function test_CloseOut_VaultReverting() public { _scenarioCloseOut(0); }
    function test_CloseOut_VaultDrained() public { _scenarioCloseOut(1); }
    function test_CloseOut_VaultQuotesDown() public { _scenarioCloseOut(2); }
    function test_SettlePhysical_VaultReverting() public { _scenarioSettlePhysical(0); }
    function test_SettlePhysical_VaultDrained() public { _scenarioSettlePhysical(1); }
    function test_SettlePhysical_VaultQuotesDown() public { _scenarioSettlePhysical(2); }
    function test_SettleCash_VaultReverting() public { _scenarioSettleCash(0); }
    function test_SettleCash_VaultDrained() public { _scenarioSettleCash(1); }
    function test_SettleCash_VaultQuotesDown() public { _scenarioSettleCash(2); }

    function test_SettleFailedDelivery_VaultDown() public {
        uint256 id = _open(false);
        Tenor.Trade memory t = tenor.getTrade(id);
        _break(0);
        vm.warp(t.maturity + 121);
        _setSpot(SPOT);
        tenor.settle(id); // neither leg funded: mutual cancellation
        assertEq(uint8(tenor.getTrade(id).status), uint8(Tenor.Status.DeliveryFailed));
        _accounting();
    }

    // ------------------------------ withdraw paths with a dead vault ------------------------------

    /// hedger ends up with plain settlement proceeds AND vault shares; then the vault dies.
    function _plainAndShares(uint256 kind) internal returns (uint256 plain, uint256 shares) {
        uint256 id = _open(true);
        vm.warp(tenor.getTrade(id).maturity);
        _setSpot(1.20e8);
        tenor.settle(id);
        plain = tenor.usdcBalance(hedger);
        shares = tenor.vaultShares(hedger);
        assertGt(plain, IM);
        assertGt(shares, 0);
        valueAtBreak = tenor.vaultValueOf(hedger); // > shares: ~30 days of yield accrued
        _break(kind);
    }

    function _scenarioWithdraw(uint256 kind) internal {
        (uint256 plain, uint256 shares) = _plainAndShares(kind);
        uint256 got = _withdrawAll(hedger);
        assertEq(got, plain, "withdraw() still pays the plain part");
        assertEq(tenor.vaultShares(hedger), shares, "shares stay put");
        assertTrue(tenor.yieldMode(hedger), "opt-in unchanged by withdraw");
        _accounting();
        // once the vault works again, the rest is recoverable
        _repair(kind);
        uint256 rest = _withdrawAll(hedger);
        assertApproxEqAbs(rest, valueAtBreak, 1, "vault part (with its yield) recovered");
        assertEq(tenor.vaultShares(hedger), 0);
        _accounting();
    }

    function test_Withdraw_PaysPlainWhenVaultReverting() public { _scenarioWithdraw(0); }
    function test_Withdraw_PaysPlainWhenVaultDrained() public { _scenarioWithdraw(1); }
    function test_Withdraw_PaysPlainWhenQuotesDown() public { _scenarioWithdraw(2); }

    function _scenarioWithdrawMargin(uint256 kind) internal {
        (uint256 plain, uint256 shares) = _plainAndShares(kind);
        // the plain part is withdrawable even now
        vm.prank(hedger);
        tenor.withdrawMargin(plain);
        assertEq(usdc.balanceOf(hedger), plain);
        // the vault part is not: strict path reports VaultRedeemFailed and rolls back
        vm.prank(hedger);
        vm.expectRevert(Tenor.VaultRedeemFailed.selector);
        tenor.withdrawMargin(100e6);
        assertEq(tenor.vaultShares(hedger), shares, "nothing lost");
        _accounting();
        // after the vault is funded / healthy again the same call succeeds
        _repair(kind);
        vm.prank(hedger);
        tenor.withdrawMargin(100e6);
        assertEq(usdc.balanceOf(hedger), plain + 100e6);
        assertApproxEqAbs(tenor.freeMarginOf(hedger), valueAtBreak - 100e6, 2);
        _accounting();
    }

    function test_WithdrawMargin_VaultPartRevertsThenRecoversAfterRepair() public { _scenarioWithdrawMargin(0); }
    function test_WithdrawMargin_VaultDrainedRevertsThenRecoversAfterRefund() public { _scenarioWithdrawMargin(1); }

    /// Observed: if the vault cannot QUOTE, withdrawMargin surfaces the vault's own revert (convertToShares is not guarded).
    function test_WithdrawMargin_QuotesDown_BubblesVaultError() public {
        _break(2);
        vm.prank(hedger);
        vm.expectRevert(bytes("quote down"));
        tenor.withdrawMargin(1e6);
        // best-effort exits still work
        vm.prank(hedger);
        tenor.withdraw();
        _repair(2);
        vm.prank(hedger);
        tenor.withdrawMargin(1e6);
        assertEq(usdc.balanceOf(hedger), 1e6);
    }

    function _scenarioOptOut(uint256 kind) internal {
        _break(kind);
        uint256 shares = tenor.vaultShares(hedger);
        vm.expectEmit(true, false, false, true, address(tenor));
        emit Tenor.YieldModeSet(hedger, false);
        _yMode(hedger, false); // must not revert
        assertFalse(tenor.yieldMode(hedger), "flag flipped despite failed redeem");
        assertEq(tenor.vaultShares(hedger), shares, "shares untouched");
        assertEq(tenor.usdcBalance(hedger), 0);
        // new deposits are now plain
        _deposit(hedger, 5e6);
        assertEq(tenor.usdcBalance(hedger), 5e6);
        _repair(kind);
        uint256 got = _withdrawAll(hedger);
        assertApproxEqAbs(got, shares + 5e6, 1, "everything recoverable");
        _accounting();
    }

    function test_SetYieldModeFalse_FlipsFlagWhenVaultReverting() public { _scenarioOptOut(0); }
    function test_SetYieldModeFalse_FlipsFlagWhenVaultDrained() public { _scenarioOptOut(1); }
    function test_SetYieldModeFalse_FlipsFlagWhenQuotesDown() public { _scenarioOptOut(2); }

    function test_OptOutSucceedsAfterRepair() public {
        _break(1);
        _yMode(dealer, false);
        assertEq(tenor.vaultShares(dealer), DEP);
        _repair(1);
        _yMode(dealer, true); // re-enter ok
        _yMode(dealer, false); // now redeems everything
        assertEq(tenor.vaultShares(dealer), 0);
        assertEq(tenor.usdcBalance(dealer), DEP);
    }

    // ---------------------------- redemptions that ARE required ----------------------------

    function test_Open_NeedingRedeem_RevertsVaultRedeemFailed_ButPlainStillOpens() public {
        _break(0);
        Tenor.Quote memory q = _mkQuote(Tenor.Side.SELL_USD, N, 30 days, false);
        bytes memory sig = _sign(dealerPk, q);
        vm.prank(hedger);
        vm.expectRevert(Tenor.VaultRedeemFailed.selector);
        tenor.open(q, sig);
        assertEq(tenor.nextTradeId(), 1);

        // with plain balances it opens regardless of the vault state
        _deposit(bob, IM); // bob is a plain user
        _deposit(dealer, IM); // dealer is opted in but deposit fell back to plain (vault deposit reverts)
        assertEq(tenor.usdcBalance(dealer), IM);
        vm.prank(bob);
        tenor.open(q, sig);
        assertEq(tenor.nextTradeId(), 2);
    }

    function test_TopUp_NeedingRedeem_RevertsVaultRedeemFailed() public {
        uint256 id = _open(false);
        _break(1);
        vm.prank(hedger);
        vm.expectRevert(Tenor.VaultRedeemFailed.selector);
        tenor.topUp(id, 1e6);
        _repair(1);
        vm.prank(hedger);
        tenor.topUp(id, 1e6);
        assertEq(tenor.getTrade(id).hedgerMargin, IM + 1e6);
    }

    // ------------------------------------ deposit fallback ------------------------------------

    function test_Deposit_FallsBackToPlainWhenVaultDepositReverts() public {
        vault.setFaults(true, false, false);
        uint256 sharesBefore = tenor.vaultShares(hedger);
        usdc.mint(hedger, 7e6);
        vm.startPrank(hedger);
        usdc.approve(address(tenor), 7e6);
        vm.expectEmit(true, false, false, true, address(tenor));
        emit Tenor.MarginDeposited(hedger, 7e6);
        tenor.depositMargin(7e6);
        vm.stopPrank();
        assertEq(tenor.usdcBalance(hedger), 7e6, "credited as plain");
        assertEq(tenor.vaultShares(hedger), sharesBefore);
        assertEq(usdc.allowance(address(tenor), address(vault)), 0, "approval cleaned up");
        assertEq(usdc.balanceOf(address(tenor)), 7e6 + 0 + 0);
        _accounting();
    }

    function test_SetYieldModeOn_DepositRevertingKeepsPlain_SweepReportsFailure() public {
        _deposit(bob, 9e6);
        vault.setFaults(true, false, false);
        _yMode(bob, true);
        assertTrue(tenor.yieldMode(bob));
        assertEq(tenor.usdcBalance(bob), 9e6, "stays plain, nothing lost");
        assertEq(usdc.allowance(address(tenor), address(vault)), 0);
        vm.prank(bob);
        vm.expectRevert(Tenor.VaultDepositFailed.selector);
        tenor.sweepToYield();
        // after repair the sweep works
        vault.setFaults(false, false, false);
        vm.prank(bob);
        tenor.sweepToYield();
        assertEq(tenor.usdcBalance(bob), 0);
        assertEq(tenor.vaultShares(bob), 9e6);
    }

    // --------------------------------------- views ---------------------------------------

    function test_Views_FallBackToPrincipalWhenQuotesFail() public {
        skip(30 days);
        assertGt(tenor.vaultValueOf(hedger), DEP);
        _break(2);
        assertEq(tenor.vaultValueOf(hedger), tenor.yieldPrincipal(hedger), "falls back to cost basis");
        assertEq(tenor.freeMarginOf(hedger), DEP);
        assertEq(tenor.yieldEarned(hedger), 0);
        assertTrue(tenor.yieldActive(), "still accepts deposits (they just fall back)");
    }

    function test_Recovery_UnderfundedVaultThenFunded_PaysPrincipalAndYield() public {
        skip(90 days);
        _break(1); // reserve emptied: nothing redeemable
        assertEq(_withdrawAll(hedger), 0, "best effort pays nothing, does not revert");
        assertEq(tenor.vaultShares(hedger), DEP);
        vm.prank(hedger);
        vm.expectRevert(Tenor.VaultRedeemFailed.selector);
        tenor.withdrawMargin(1);
        _fundReserve(20_000e6);
        assertEq(vault.reserveShortfall(), 0);
        uint256 got = _withdrawAll(hedger);
        assertApproxEqAbs(got, DEP + DEP * 450 * 90 days / (365 days * 10_000), 2, "principal + 90d yield");
        assertEq(tenor.vaultShares(hedger), 0);
    }

    // -------------------------------- (8) VaultMismatch --------------------------------

    function _freshTenorWithMismatch(MismatchVault.Mode m) internal returns (MismatchVault mv) {
        mv = new MismatchVault();
        mv.setMode(m);
        usdc.mint(address(mv), 10);
        tenor = _deployTenor(address(mv));
    }

    function _depositExpectingMismatch(uint256 amt) internal {
        _yMode(alice, true);
        usdc.mint(alice, amt);
        vm.startPrank(alice);
        usdc.approve(address(tenor), amt);
        vm.expectRevert(Tenor.VaultMismatch.selector);
        tenor.depositMargin(amt);
        vm.stopPrank();
        assertEq(usdc.balanceOf(alice), amt, "whole deposit reverted");
        assertEq(tenor.usdcBalance(alice), 0);
        assertEq(tenor.totalVaultShares(), 0);
    }

    function test_VaultMismatch_PullsLess() public {
        _freshTenorWithMismatch(MismatchVault.Mode.PullLess);
        _depositExpectingMismatch(100e6);
    }

    function test_VaultMismatch_PullsNothing() public {
        _freshTenorWithMismatch(MismatchVault.Mode.PullNothing);
        _depositExpectingMismatch(100e6);
    }

    function test_VaultMismatch_ZeroShares() public {
        _freshTenorWithMismatch(MismatchVault.Mode.ZeroShares);
        _depositExpectingMismatch(100e6);
    }

    function test_VaultMismatch_ReturnsTokens() public {
        _freshTenorWithMismatch(MismatchVault.Mode.GiveTokensBack);
        _depositExpectingMismatch(100e6);
    }

    function test_VaultMismatch_SweepAndOptInAlsoReject() public {
        _freshTenorWithMismatch(MismatchVault.Mode.PullLess);
        _deposit(bob, 50e6); // plain: not opted in
        assertEq(tenor.usdcBalance(bob), 50e6);
        vm.prank(bob);
        vm.expectRevert(Tenor.VaultMismatch.selector);
        tenor.setYieldMode(true); // would sweep the 50e6
        assertFalse(tenor.yieldMode(bob), "reverted atomically");
        assertEq(tenor.usdcBalance(bob), 50e6);
        assertEq(usdc.allowance(address(tenor), address(tenor.yieldVault())), 0);
    }

    function test_VaultMismatch_PlainUsersUnaffected() public {
        _freshTenorWithMismatch(MismatchVault.Mode.PullLess);
        _deposit(carol, 5e6);
        vm.prank(carol);
        tenor.withdraw();
        assertEq(usdc.balanceOf(carol), 5e6);
    }
}
