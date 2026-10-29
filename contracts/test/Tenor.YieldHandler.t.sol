// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {TenorHandler} from "./Tenor.Handler.t.sol";
import {ToggleVault} from "./Tenor.Yield.t.sol";
import {Tenor} from "../Tenor.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockEURC} from "./mocks/MockEURC.sol";
import {MockAggregator} from "../MockAggregator.sol";

/// @dev TenorHandler + yield actions. Inherits every v1 action (deposit, withdraw, open, topUp, mark, closeOut,
/// settle, matureAndSettle, warp, setPrice, ...) so yield-mode users flow through the same trade paths.
/// Contains no test/invariant functions.
contract TenorYieldHandler is TenorHandler {
    ToggleVault public vault;

    // yield coverage counters
    uint256 public nModeOn;
    uint256 public nModeOff;
    uint256 public nYieldDeposit;
    uint256 public nSweep;
    uint256 public nVaultWithdraw;
    uint256 public nYieldOpen;
    uint256 public nBump;
    uint256 public nPause;
    uint256 public nFaultsOn;
    uint256 public nWithdrawAllFromShares;

    constructor(
        Tenor t, MockUSDC u, MockEURC e, MockAggregator f, address oracleOwner_,
        address[3] memory hedgers, address[2] memory dealers_, uint256[2] memory keys, ToggleVault v
    ) TenorHandler(t, u, e, f, oracleOwner_, hedgers, dealers_, keys) {
        vault = v;
    }

    // ------------------------------------ account-level yield ------------------------------------

    function toggleYieldMode(uint256 who, bool on) external {
        address u = _user(who);
        vm.prank(u);
        try tenor.setYieldMode(on) {
            if (on) ++nModeOn;
            else ++nModeOff;
        } catch {}
    }

    /// Opts in and deposits into the vault (the main way into yield mode).
    function yieldDeposit(uint256 who, uint256 amt) external {
        address u = _user(who);
        amt = bound(amt, 2, 200e6);
        vm.prank(u);
        try tenor.setYieldMode(true) {} catch {}
        uint256 before = tenor.totalVaultShares();
        vm.prank(u);
        try tenor.depositMargin(amt) {} catch {}
        if (tenor.totalVaultShares() > before) ++nYieldDeposit;
    }

    function sweep(uint256 who) external {
        address u = _user(who);
        if (tenor.usdcBalance(u) == 0) return;
        vm.prank(u);
        try tenor.sweepToYield() {
            ++nSweep;
        } catch {}
    }

    /// Creates a plain balance (deposit while the vault is paused) and sweeps it into the vault.
    function plainThenSweep(uint256 who, uint256 amt) external {
        address u = _user(who);
        amt = bound(amt, 2, 100e6);
        vm.prank(u);
        try tenor.setYieldMode(true) {} catch {}
        bool wasPaused = tenor.yieldDepositsPaused();
        vm.prank(oracleOwner);
        tenor.setYieldDepositsPaused(true);
        vm.prank(u);
        tenor.depositMargin(amt); // plain
        vm.prank(oracleOwner);
        tenor.setYieldDepositsPaused(wasPaused);
        vm.prank(u);
        try tenor.sweepToYield() {
            ++nSweep;
        } catch {}
    }

    /// withdrawMargin over the whole free margin (plain + vault value), so it routinely hits the redeem branch.
    function withdrawFree(uint256 who, uint256 amt) external {
        address u = _user(who);
        amt = bound(amt, 0, tenor.freeMarginOf(u));
        uint256 redeems = vault.redeemCalls();
        vm.prank(u);
        try tenor.withdrawMargin(amt) {
            if (vault.redeemCalls() > redeems) ++nVaultWithdraw;
        } catch {}
    }

    function withdrawEverything(uint256 who) external {
        address u = _user(who);
        uint256 s = tenor.vaultShares(u);
        vm.prank(u);
        tenor.withdraw();
        if (s != 0 && tenor.vaultShares(u) < s) ++nWithdrawAllFromShares;
    }

    // ------------------------------------ trades from the vault ------------------------------------

    function _vaultOnly(address u, uint256 amt) internal {
        vm.prank(u);
        try tenor.setYieldMode(true) {} catch {}
        uint256 p = tenor.usdcBalance(u);
        if (p != 0) {
            vm.prank(u);
            tenor.withdrawMargin(p); // push plain out so the trade must redeem shares
        }
        vm.prank(u);
        try tenor.depositMargin(amt) {} catch {}
    }

    /// Both parties hold their free margin only as vault shares, then the trade is opened (forces on-demand redeem).
    function yieldOpen(
        uint256 h, uint256 d, uint256 sideSeed, uint256 notional, uint256 tenorSecs, bool cash, uint256 offset
    ) external {
        notional = bound(notional, 1e6, 50e6);
        uint256 margin = (notional * 500 + 9_999) / 10_000;
        _vaultOnly(users[h % 3], margin * 2);
        _vaultOnly(users[3 + (d % 2)], margin * 2);
        uint256 nextId = tenor.nextTradeId();
        uint256 redeems = vault.redeemCalls();
        try this.open(h, d, sideSeed, notional, tenorSecs, cash, offset) {
            if (tenor.nextTradeId() > nextId && vault.redeemCalls() > redeems) ++nYieldOpen;
        } catch {}
    }

    // ----------------------------------------- vault / owner -----------------------------------------

    function _fundReserve() internal {
        uint256 short = vault.reserveShortfall();
        if (short == 0) return;
        short += 1e6;
        usdc.mint(address(this), short);
        usdc.approve(address(vault), short);
        vault.fundYield(short);
    }

    function bumpPrice(uint256 bps) external {
        bps = bound(bps, 1, 40);
        vm.prank(oracleOwner);
        vault.bumpPrice(bps);
        ++nBump;
        _fundReserve();
    }

    /// Warp that also keeps the oracle fresh and the vault redeemable.
    function warpFund(uint256 dt) external {
        dt = bound(dt, 1, 20 days);
        vm.warp(block.timestamp + dt);
        vm.prank(oracleOwner);
        feed.setAnswer(int256(spot));
        _fundReserve();
    }

    function fundReserve() external {
        _fundReserve();
    }

    function togglePause(uint256 seed) external {
        vm.prank(oracleOwner);
        tenor.setYieldDepositsPaused(seed % 4 == 0);
        ++nPause;
    }

    /// Randomly breaks / repairs the vault's deposit and redeem (quotes stay up so views remain comparable).
    function setFaults(uint256 seed) external {
        bool on = seed % 5 == 0;
        vault.setFaults(on && seed % 2 == 0, on, false);
        if (on) ++nFaultsOn;
    }
}
