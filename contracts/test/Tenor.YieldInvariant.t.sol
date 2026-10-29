// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {console2} from "forge-std/Test.sol";
import {TenorYieldBase} from "./Tenor.Yield.t.sol";
import {TenorYieldHandler} from "./Tenor.YieldHandler.t.sol";
import {Tenor} from "../Tenor.sol";

/// forge-config: default.invariant.runs = 256
/// forge-config: default.invariant.depth = 200
/// forge-config: default.invariant.fail_on_revert = false
contract TenorYieldInvariantTest is TenorYieldBase {
    TenorYieldHandler internal handler;

    /// Per-account floor rounding of convertToAssets: at most 1 wei each, 5 accounts.
    uint256 internal constant VALUE_ROUNDING_TOLERANCE = 5;

    function setUp() public override {
        super.setUp();
        address[3] memory hs = [hedger, bob, carol];
        address[2] memory ds = [dealer, dealer2];
        uint256[2] memory ks = [dealerPk, dealer2Pk];
        handler = new TenorYieldHandler(tenor, usdc, eurc, feed, owner, hs, ds, ks, vault);
        targetContract(address(handler));
    }

    // ----------------------------------- aggregates -----------------------------------

    function _plain() internal view returns (uint256 sum) {
        for (uint256 i; i < 5; ++i) sum += tenor.usdcBalance(handler.users(i));
    }

    function _shares() internal view returns (uint256 sum) {
        for (uint256 i; i < 5; ++i) sum += tenor.vaultShares(handler.users(i));
    }

    function _userVaultValue() internal view returns (uint256 sum) {
        for (uint256 i; i < 5; ++i) sum += tenor.vaultValueOf(handler.users(i));
    }

    function _sumFree() internal view returns (uint256 sum) {
        for (uint256 i; i < 5; ++i) sum += tenor.freeMarginOf(handler.users(i));
    }

    function _locked() internal view returns (uint256 sum) {
        for (uint256 id = 1; id < tenor.nextTradeId(); ++id) {
            Tenor.Trade memory t = tenor.getTrade(id);
            sum += t.hedgerMargin + t.dealerMargin + t.usdLegAmount;
        }
    }

    // ------------------------------------ invariants ------------------------------------

    /// (a) EXACT: USDC held by Tenor == plain balances + locked trade margins + funded USD legs.
    /// (Vault-held funds are NOT in Tenor's USDC balance; locked margin is never in the vault.)
    function invariant_UsdcSolvencyExact() public view {
        assertEq(usdc.balanceOf(address(tenor)), _plain() + _locked(), "USDC solvency (exact)");
    }

    /// (b) Tenor's vault-share balance == totalVaultShares == sum of per-account shares (free margin only).
    function invariant_VaultShareAccounting() public view {
        uint256 total = tenor.totalVaultShares();
        assertEq(vault.balanceOf(address(tenor)), total, "vault.balanceOf(tenor) == totalVaultShares");
        assertEq(_shares(), total, "sum of account shares == totalVaultShares");
    }

    /// (c) convertToAssets(totalVaultShares) >= sum of per-account values (floor is superadditive), and the combined
    /// solvency statement holds: USDC held + vault-share value >= sum freeMarginOf + locked margins + legs, with a
    /// surplus of at most VALUE_ROUNDING_TOLERANCE wei (floor-rounding dust, <1 wei per account with shares).
    /// Tolerance is exactly: total.convertToAssets(sum shares) - sum_i convertToAssets(shares_i).
    function invariant_VaultValueCoversAccountsWithinRounding() public view {
        uint256 total = vault.convertToAssets(tenor.totalVaultShares());
        uint256 sumValue = _userVaultValue();
        assertGe(total, sumValue, "vault value >= sum of account values");
        assertLe(total - sumValue, VALUE_ROUNDING_TOLERANCE, "per-account rounding dust bounded");

        uint256 assets = usdc.balanceOf(address(tenor)) + total;
        uint256 owed = _sumFree() + _locked();
        assertGe(assets, owed, "solvent: assets >= liabilities");
        assertLe(assets - owed, VALUE_ROUNDING_TOLERANCE, "surplus is only rounding dust");
    }

    /// An account with no shares carries no cost basis; per-account value is consistent with the quote.
    function invariant_NoOrphanPrincipal() public view {
        for (uint256 i; i < 5; ++i) {
            address u = handler.users(i);
            if (tenor.vaultShares(u) == 0) {
                assertEq(tenor.yieldPrincipal(u), 0, "principal without shares");
                assertEq(tenor.vaultValueOf(u), 0);
            }
        }
    }

    /// (d) EURC solvency unchanged by the feature.
    function invariant_EurcSolvency() public view {
        uint256 sum;
        for (uint256 i; i < 5; ++i) sum += tenor.eurcBalance(handler.users(i));
        for (uint256 id = 1; id < tenor.nextTradeId(); ++id) sum += tenor.getTrade(id).eurLegAmount;
        assertEq(eurc.balanceOf(address(tenor)), sum, "EURC solvency (exact)");
    }

    /// (e) mark() only shifts value between the two parties of one trade.
    function invariant_VariationMarginZeroSum() public view {
        assertFalse(handler.vmViolation(), "mark changed hedgerMargin+dealerMargin");
    }

    function invariant_TerminalTradesAreEmpty() public view {
        for (uint256 id = 1; id < tenor.nextTradeId(); ++id) {
            Tenor.Trade memory t = tenor.getTrade(id);
            if (t.status != Tenor.Status.Open) {
                assertEq(t.hedgerMargin + t.dealerMargin, 0, "margin left in terminal trade");
                assertEq(t.usdLegAmount + t.eurLegAmount, 0, "leg left in terminal trade");
            }
        }
    }

    function afterInvariant() public view {
        console2.log("open/mark/calls/closeOut", handler.nOpen(), handler.nMark(), handler.nCalls());
        console2.log("delivered/failed", handler.nDelivered(), handler.nFailed());
        console2.log("modeOn/modeOff/yieldDeposit/sweep", handler.nModeOn(), handler.nModeOff(), handler.nYieldDeposit());
        console2.log("sweep/vaultWithdraw/yieldOpen/withdrawAllShares", handler.nSweep(), handler.nVaultWithdraw(), handler.nYieldOpen());
        console2.log("withdrawAllFromShares/bump/pause/faultsOn", handler.nWithdrawAllFromShares(), handler.nBump(), handler.nFaultsOn());
        console2.log("vault depositCalls/redeemCalls", vault.depositCalls(), vault.redeemCalls());
    }

    // --------------------------- coverage proof (deterministic) ---------------------------

    /// Scripted walk through the handler proving the yield paths are reachable and the invariants hold on them.
    function test_HandlerReachesEveryYieldPath() public {
        handler.yieldDeposit(0, 100e6);
        handler.yieldDeposit(3, 100e6);
        handler.toggleYieldMode(1, true);
        handler.deposit(1, 20e6); // routed to vault (user 1 is in yield mode)
        handler.yieldOpen(0, 0, 0, 10e6, 30 days, false, 40);
        assertEq(handler.nYieldOpen(), 1, "trade opened by redeeming shares");
        handler.bumpPrice(30);
        handler.warpFund(2 days);
        handler.setPrice(1.25e8);
        handler.mark(1);
        handler.sweep(0);
        handler.plainThenSweep(2, 10e6);
        assertGt(handler.nSweep(), 0, "sweep");
        handler.withdrawFree(0, 5e6);
        handler.togglePause(0);
        handler.togglePause(1);
        handler.setFaults(5);
        handler.setFaults(1);
        handler.matureAndSettle(1, true, true, 0);
        handler.withdrawEverything(3);
        handler.toggleYieldMode(0, false);
        handler.fundReserve();

        assertGt(handler.nYieldDeposit(), 0, "yieldDeposit");
        assertGt(handler.nModeOn(), 0, "modeOn");
        assertGt(handler.nModeOff(), 0, "modeOff");
        assertGt(handler.nBump(), 0, "bump");
        assertGt(handler.nMark(), 0, "mark");
        assertGt(handler.nPause(), 0, "pause");
        assertGt(handler.nFaultsOn(), 0, "faults");
        assertGt(handler.nDelivered() + handler.nFailed(), 0, "settled");
        assertGt(handler.nWithdrawAllFromShares(), 0, "withdraw() redeemed shares");
        assertGt(vault.redeemCalls(), 0);
        assertGt(vault.depositCalls(), 0);

        invariant_UsdcSolvencyExact();
        invariant_VaultShareAccounting();
        invariant_VaultValueCoversAccountsWithinRounding();
        invariant_NoOrphanPrincipal();
        invariant_EurcSolvency();
        invariant_VariationMarginZeroSum();
        invariant_TerminalTradesAreEmpty();
    }
}
