// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {TenorTestBase} from "./Tenor.Base.t.sol";
import {Tenor} from "../Tenor.sol";
import {MockYieldVault} from "../MockYieldVault.sol";

/// @dev MockYieldVault whose deposit / redeem / quotes can be switched to revert, with call counters.
contract ToggleVault is MockYieldVault {
    bool public failDeposit;
    bool public failRedeem;
    bool public failQuote;
    uint256 public depositCalls;
    uint256 public redeemCalls;

    constructor(address owner_, IERC20 asset_) MockYieldVault(owner_, asset_) {}

    function setFaults(bool d, bool r, bool q) external {
        failDeposit = d;
        failRedeem = r;
        failQuote = q;
    }

    function deposit(uint256 assets, address receiver) public override returns (uint256) {
        if (failDeposit) revert("deposit down");
        ++depositCalls;
        return super.deposit(assets, receiver);
    }

    function redeem(uint256 shares, address receiver, address owner_) public override returns (uint256) {
        if (failRedeem) revert("redeem down");
        ++redeemCalls;
        return super.redeem(shares, receiver, owner_);
    }

    function convertToAssets(uint256 shares) public view override returns (uint256) {
        if (failQuote) revert("quote down");
        return super.convertToAssets(shares);
    }

    function convertToShares(uint256 assets) public view override returns (uint256) {
        if (failQuote) revert("quote down");
        return super.convertToShares(assets);
    }
}

/// @dev Shared yield fixtures. `tenor` is a FRESH Tenor wired to a funded ToggleVault over USDC.
/// No test functions here (every category file inherits it).
abstract contract TenorYieldBase is TenorTestBase {
    ToggleVault internal vault;
    address internal alice = makeAddr("alice");
    uint256 internal constant RESERVE = 1_000_000e6;

    function setUp() public virtual override {
        super.setUp();
        vault = new ToggleVault(owner, IERC20(USDC_ADDR));
        _fundReserve(RESERVE);
        tenor = _deployTenor(address(vault));
    }

    function _fundReserve(uint256 amount) internal {
        usdc.mint(address(this), amount);
        usdc.approve(address(vault), amount);
        vault.fundYield(amount);
    }

    function _deployTenor(address v) internal returns (Tenor t) {
        address[] memory ds = new address[](2);
        ds[0] = dealer;
        ds[1] = dealer2;
        t = new Tenor(owner, address(eurc), address(feed), RUSD, REUR, ds, v);
        vm.prank(owner);
        t.setRiskParams(Tenor.RiskParams(500, 300, 50, 60, 120, 120, 300, 50e6, 90_000));
    }

    function _yMode(address u, bool on) internal {
        vm.prank(u);
        tenor.setYieldMode(on);
    }

    function _deposit(address u, uint256 amt) internal {
        usdc.mint(u, amt);
        vm.startPrank(u);
        usdc.approve(address(tenor), type(uint256).max);
        tenor.depositMargin(amt);
        vm.stopPrank();
    }

    /// Opt in, then deposit (lands in the vault).
    function _yFund(address u, uint256 amt) internal {
        _yMode(u, true);
        _deposit(u, amt);
    }

    function _withdrawAll(address u) internal returns (uint256 got) {
        uint256 before = usdc.balanceOf(u);
        vm.prank(u);
        tenor.withdraw();
        got = usdc.balanceOf(u) - before;
    }

    function _pause(bool p) internal {
        vm.prank(owner);
        tenor.setYieldDepositsPaused(p);
    }

    /// Tenor-wide accounting identity for a set of accounts (no trades involved).
    function _assertShareAccounting(address a, address b) internal view {
        assertEq(vault.balanceOf(address(tenor)), tenor.totalVaultShares(), "vault shares held == totalVaultShares");
        assertEq(tenor.totalVaultShares(), tenor.vaultShares(a) + tenor.vaultShares(b), "total == sum");
    }
}

/// @dev (1) Yield OFF (vault == address(0)) behaves exactly like v1.
contract TenorYieldOffTest is TenorTestBase {
    function test_Off_FreshDefaultsAreV2() public {
        address[] memory ds = new address[](0);
        Tenor t = new Tenor(owner, address(eurc), address(feed), RUSD, REUR, ds, address(0));
        assertEq(t.cureWindow(), 300, "default cure window");
        assertEq(t.deliveryGrace(), 900, "default delivery grace");
        assertEq(address(t.yieldVault()), address(0));
        assertFalse(t.yieldDepositsPaused());
        assertFalse(t.yieldActive());
    }

    function test_Off_FixturePinsV1Windows() public view {
        assertEq(tenor.cureWindow(), 120);
        assertEq(tenor.deliveryGrace(), 120);
    }

    function test_Off_SetYieldModeTrueReverts() public {
        vm.prank(hedger);
        vm.expectRevert(Tenor.YieldUnavailable.selector);
        tenor.setYieldMode(true);
        assertFalse(tenor.yieldMode(hedger));
    }

    function test_Off_SetYieldModeFalseIsHarmless() public {
        vm.expectEmit(true, false, false, true, address(tenor));
        emit Tenor.YieldModeSet(hedger, false);
        vm.prank(hedger);
        tenor.setYieldMode(false);
        assertFalse(tenor.yieldMode(hedger));
    }

    function test_Off_SweepToYieldReverts() public {
        _fund(hedger, 1e6);
        vm.prank(hedger);
        vm.expectRevert(Tenor.YieldUnavailable.selector);
        tenor.sweepToYield();
    }

    function test_Off_ViewsAreInert() public {
        _fund(hedger, 5e6);
        assertFalse(tenor.yieldActive());
        assertEq(tenor.vaultValueOf(hedger), 0);
        assertEq(tenor.freeMarginOf(hedger), 5e6);
        assertEq(tenor.marginOf(hedger), 5e6);
        assertEq(tenor.yieldEarned(hedger), 0);
        assertEq(tenor.totalVaultShares(), 0);
    }

    function test_Off_DepositWithdrawOpenUnchanged() public {
        uint256 id = _openTrade(Tenor.Side.SELL_USD, false);
        assertEq(usdc.balanceOf(address(tenor)), 2 * IM, "only locked margins held");
        assertEq(tenor.marginOf(hedger), 0);
        _fund(hedger, 3e6);
        assertEq(usdc.balanceOf(address(tenor)), 2 * IM + 3e6);
        vm.prank(hedger);
        tenor.withdraw();
        assertEq(usdc.balanceOf(hedger), 3e6);
        assertEq(tenor.getTrade(id).hedgerMargin, IM);
        assertEq(tenor.totalVaultShares(), 0);
    }

    function test_Off_InsufficientBalanceRevertsPlain() public {
        _fund(hedger, 1e6);
        vm.prank(hedger);
        vm.expectRevert(Tenor.InsufficientMargin.selector);
        tenor.withdrawMargin(1e6 + 1);

        vm.prank(hedger);
        tenor.withdraw(); // empty it
        Tenor.Quote memory q = _mkQuote(Tenor.Side.SELL_USD, N, 30 days, false);
        bytes memory sig = _sign(dealerPk, q);
        _fund(dealer, IM);
        _fund(hedger, IM - 1);
        vm.prank(hedger);
        vm.expectRevert(Tenor.InsufficientMargin.selector);
        tenor.open(q, sig);
    }

    function test_Off_ADeployedVaultDoesNotAutoOptIn() public {
        ToggleVault v = new ToggleVault(owner, IERC20(USDC_ADDR));
        vm.prank(owner);
        tenor.setYieldVault(address(v));
        _fund(hedger, 4e6); // never opted in
        assertEq(tenor.marginOf(hedger), 4e6, "stays plain");
        assertEq(tenor.totalVaultShares(), 0);
        assertEq(v.depositCalls(), 0);
    }
}

/// @dev (2)+(3): opt-in deposit/withdraw accounting and yield accrual.
contract TenorYieldTest is TenorYieldBase {
    uint256 internal constant TEN_K = 10_000e6;
    // 10,000 USDC * 4.5% * 90/365 (independent simple-interest figure)
    uint256 internal constant EARNED_90D = 110_958_904;

    function test_Wiring_ConstructorSetsVault() public view {
        assertEq(address(tenor.yieldVault()), address(vault));
        assertTrue(tenor.yieldActive());
        assertEq(tenor.cureWindow(), 120);
    }

    function test_Wiring_ConstructorEmitsYieldVaultSet() public {
        address[] memory ds = new address[](0);
        vm.expectEmit(true, false, false, false);
        emit Tenor.YieldVaultSet(address(vault));
        new Tenor(owner, address(eurc), address(feed), RUSD, REUR, ds, address(vault));
    }

    function test_Wiring_FreshYieldTenorKeepsV2Defaults() public {
        address[] memory ds = new address[](0);
        Tenor t = new Tenor(owner, address(eurc), address(feed), RUSD, REUR, ds, address(vault));
        assertEq(t.cureWindow(), 300);
        assertEq(t.deliveryGrace(), 900);
    }

    // ------------------------------- deposit / withdraw -------------------------------

    function test_Deposit_NotOptedIn_StaysPlain() public {
        _deposit(alice, 1_000e6);
        assertEq(tenor.usdcBalance(alice), 1_000e6);
        assertEq(tenor.vaultShares(alice), 0);
        assertEq(usdc.balanceOf(address(tenor)), 1_000e6);
        assertEq(vault.depositCalls(), 0);
    }

    function test_Deposit_OptedIn_RoutesToVault() public {
        uint256 amt = 1_000e6;
        _yMode(alice, true);
        usdc.mint(alice, amt);
        vm.startPrank(alice);
        usdc.approve(address(tenor), amt);
        vm.expectEmit(true, false, false, true, address(tenor));
        emit Tenor.YieldDeposited(alice, amt, amt);
        vm.expectEmit(true, false, false, true, address(tenor));
        emit Tenor.MarginDeposited(alice, amt);
        tenor.depositMargin(amt);
        vm.stopPrank();

        assertEq(tenor.usdcBalance(alice), 0, "no plain balance");
        assertEq(tenor.marginOf(alice), 0, "marginOf is plain-only");
        assertEq(tenor.vaultShares(alice), amt, "1:1 shares at price 1");
        assertEq(tenor.yieldPrincipal(alice), amt);
        assertEq(tenor.totalVaultShares(), amt);
        assertEq(tenor.freeMarginOf(alice), amt);
        assertEq(usdc.balanceOf(address(tenor)), 0, "Tenor holds no USDC");
        assertEq(usdc.allowance(address(tenor), address(vault)), 0, "no lingering allowance");
        assertEq(vault.balanceOf(address(tenor)), amt);
        assertEq(tenor.yieldEarned(alice), 0);
    }

    function test_Deposit_ZeroStillReverts() public {
        _yMode(alice, true);
        vm.prank(alice);
        vm.expectRevert(Tenor.ZeroAmount.selector);
        tenor.depositMargin(0);
    }

    function test_RoundTrip_ReturnsPrincipalExactlyAtPar() public {
        _yFund(alice, 1_000e6);
        uint256 got = _withdrawAll(alice);
        assertEq(got, 1_000e6, "principal back");
        assertEq(usdc.balanceOf(alice), 1_000e6);
        assertEq(usdc.balanceOf(address(tenor)), 0);
        assertEq(tenor.vaultShares(alice), 0);
        assertEq(tenor.yieldPrincipal(alice), 0);
        assertEq(tenor.totalVaultShares(), 0);
        assertEq(tenor.usdcBalance(alice), 0);
        assertEq(tenor.yieldRealized(alice), 0, "no yield without time");
    }

    function test_RoundTrip_ZeroBalanceWithdrawIsNoop() public {
        vm.prank(alice);
        tenor.withdraw();
        assertEq(usdc.balanceOf(alice), 0);
    }

    function test_WithdrawMargin_PartialRedeemsFromShares() public {
        _yFund(alice, 1_000e6);
        vm.expectEmit(true, false, false, true, address(tenor));
        emit Tenor.MarginWithdrawn(alice, 300e6);
        vm.prank(alice);
        tenor.withdrawMargin(300e6);
        assertEq(usdc.balanceOf(alice), 300e6, "exact amount paid");
        assertApproxEqAbs(tenor.freeMarginOf(alice), 700e6, 2);
        assertApproxEqAbs(tenor.yieldPrincipal(alice), 700e6, 2);
        assertLe(tenor.usdcBalance(alice), 2, "at most rounding dust left plain");
        assertEq(vault.balanceOf(address(tenor)), tenor.totalVaultShares());
    }

    function test_WithdrawMargin_RedeemsOnlyTheShortfall() public {
        _yMode(alice, true);
        _deposit(alice, 1_000e6); // vault
        _pause(true);
        _deposit(alice, 50e6); // falls back to plain
        _pause(false);
        assertEq(tenor.usdcBalance(alice), 50e6);
        uint256 sharesBefore = tenor.vaultShares(alice);

        vm.prank(alice);
        tenor.withdrawMargin(200e6);

        assertEq(usdc.balanceOf(alice), 200e6, "wallet got exactly 200");
        assertApproxEqAbs(sharesBefore - tenor.vaultShares(alice), 150e6, 2, "only the 150 shortfall redeemed");
        assertLe(tenor.usdcBalance(alice), 2);
        assertApproxEqAbs(tenor.freeMarginOf(alice), 850e6, 2);
    }

    function test_WithdrawMargin_PlainCoveredDoesNotTouchVault() public {
        _yMode(alice, true);
        _deposit(alice, 1_000e6);
        _pause(true);
        _deposit(alice, 50e6);
        _pause(false);
        vm.prank(alice);
        tenor.withdrawMargin(50e6);
        assertEq(vault.redeemCalls(), 0, "no redemption needed");
        assertEq(tenor.vaultShares(alice), 1_000e6);
    }

    function test_WithdrawMargin_OverFreeMarginReverts() public {
        _yFund(alice, 100e6);
        vm.prank(alice);
        vm.expectRevert(Tenor.InsufficientMargin.selector);
        tenor.withdrawMargin(101e6);
        // no shares at all
        vm.prank(bob);
        vm.expectRevert(Tenor.InsufficientMargin.selector);
        tenor.withdrawMargin(1);
    }

    function test_SetYieldMode_On_SweepsExistingPlain() public {
        _deposit(alice, 500e6);
        vm.expectEmit(true, false, false, true, address(tenor));
        emit Tenor.YieldModeSet(alice, true);
        _yMode(alice, true);
        assertEq(tenor.usdcBalance(alice), 0);
        assertEq(tenor.vaultShares(alice), 500e6);
        assertEq(usdc.balanceOf(address(tenor)), 0);
    }

    function test_SetYieldMode_Off_RedeemsAllToPlainThenDepositsStayPlain() public {
        _yFund(alice, 500e6);
        _yMode(alice, false);
        assertFalse(tenor.yieldMode(alice));
        assertEq(tenor.vaultShares(alice), 0);
        assertEq(tenor.totalVaultShares(), 0);
        assertEq(tenor.usdcBalance(alice), 500e6, "redeemed to plain, not paid out");
        assertEq(usdc.balanceOf(address(tenor)), 500e6);
        _deposit(alice, 10e6);
        assertEq(tenor.vaultShares(alice), 0, "new deposit is plain after opt-out");
        assertEq(tenor.usdcBalance(alice), 510e6);
    }

    function test_SweepToYield_MovesPlainBalance() public {
        _yMode(alice, true);
        _pause(true);
        _deposit(alice, 80e6);
        _pause(false);
        vm.expectEmit(true, false, false, true, address(tenor));
        emit Tenor.YieldDeposited(alice, 80e6, 80e6);
        vm.prank(alice);
        tenor.sweepToYield();
        assertEq(tenor.usdcBalance(alice), 0);
        assertEq(tenor.vaultShares(alice), 80e6);
        assertEq(usdc.balanceOf(address(tenor)), 0);
    }

    function test_SweepToYield_Reverts() public {
        // not in yield mode
        _deposit(alice, 5e6);
        vm.prank(alice);
        vm.expectRevert(Tenor.YieldUnavailable.selector);
        tenor.sweepToYield();
        // in yield mode but nothing plain
        _yMode(alice, true); // sweeps the 5e6
        vm.prank(alice);
        vm.expectRevert(Tenor.ZeroAmount.selector);
        tenor.sweepToYield();
        // self-only: another account has nothing to sweep and cannot touch alice's
        vm.prank(bob);
        vm.expectRevert(Tenor.YieldUnavailable.selector);
        tenor.sweepToYield();
    }

    // ------------------------------------ accrual ------------------------------------

    function test_Accrual_90DaysOn10kIsAbout110_96() public {
        _yFund(alice, TEN_K);
        skip(90 days);
        uint256 earned = tenor.yieldEarned(alice);
        assertApproxEqAbs(earned, EARNED_90D, 3, "exact simple-interest figure");
        assertApproxEqRel(earned, 110.96e6, 1e14, "~110.96 USDC");
        assertApproxEqAbs(tenor.freeMarginOf(alice), TEN_K + EARNED_90D, 3);
        assertEq(tenor.marginOf(alice), 0, "unrealised yield is not plain margin");
        assertEq(tenor.yieldPrincipal(alice), TEN_K);
    }

    function test_Accrual_OnlyToOwningAccount() public {
        _yFund(alice, TEN_K);
        skip(90 days);
        _yFund(bob, TEN_K); // joins at day 90
        _deposit(carol, TEN_K); // never opts in
        uint256 p90 = vault.price();
        skip(90 days);
        uint256 p180 = vault.price();

        uint256 aliceExp = TEN_K * (p180 - 1e18) / 1e18; // from par
        uint256 bobExp = TEN_K * p180 / p90 - TEN_K; // from day 90
        assertApproxEqAbs(tenor.yieldEarned(alice), aliceExp, 4, "alice earns the full 180d");
        assertApproxEqAbs(tenor.yieldEarned(bob), bobExp, 4, "bob earns only since joining");
        assertGt(tenor.yieldEarned(alice), tenor.yieldEarned(bob));
        assertEq(tenor.yieldEarned(carol), 0, "non-opted-in earns nothing");
        assertEq(tenor.freeMarginOf(carol), TEN_K);
        assertEq(tenor.vaultValueOf(carol), 0);
        // alice's earnings did not change by bob joining: 180d simple interest on 10k
        assertApproxEqAbs(tenor.yieldEarned(alice), 221_917_808, 4);
    }

    function test_Accrual_BumpPriceRaisesYield() public {
        _yFund(alice, TEN_K);
        _deposit(carol, TEN_K); // plain control
        assertEq(tenor.yieldEarned(alice), 0);
        vm.prank(owner);
        vault.bumpPrice(100); // +1%
        assertApproxEqAbs(tenor.yieldEarned(alice), 100e6, 3, "+1% of 10k");
        assertApproxEqAbs(tenor.freeMarginOf(alice), TEN_K + 100e6, 3);
        assertEq(tenor.yieldEarned(carol), 0);
    }

    function test_Accrual_BumpPriceOwnerOnlyAndBounded() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vault.bumpPrice(10);
        vm.startPrank(owner);
        vm.expectRevert(MockYieldVault.ParamOutOfBounds.selector);
        vault.bumpPrice(0);
        vm.expectRevert(MockYieldVault.ParamOutOfBounds.selector);
        vault.bumpPrice(1_001);
        vm.stopPrank();
    }

    function test_Accrual_RealisedYieldPersistsAfterWithdraw() public {
        _yFund(carol, 1_000e6); // keeps the vault non-empty 
        _yFund(alice, TEN_K);
        skip(90 days);
        uint256 got = _withdrawAll(alice);
        assertApproxEqAbs(got, TEN_K + EARNED_90D, 3, "principal + yield paid");
        assertEq(tenor.vaultShares(alice), 0);
        assertEq(tenor.yieldPrincipal(alice), 0);
        assertEq(tenor.vaultValueOf(alice), 0);
        assertEq(tenor.yieldRealized(alice), got - TEN_K, "realised = payout - principal");
        assertEq(tenor.yieldEarned(alice), tenor.yieldRealized(alice), "earned persists");
        assertApproxEqAbs(tenor.yieldEarned(alice), EARNED_90D, 3);

        // a later deposit stacks on top of the realised amount
        uint256 realisedBefore = tenor.yieldRealized(alice);
        _deposit(alice, 1_000e6);
        skip(30 days);
        uint256 principal = 1_000e6;
        uint256 expectedNew = principal * 450 * 30 days / (365 days * 10_000);
        assertGt(tenor.yieldEarned(alice), realisedBefore);
        assertApproxEqAbs(tenor.yieldEarned(alice) - realisedBefore, expectedNew, 150_000, "~3.7 USDC on 1000/30d");
    }

    function test_Accrual_PartialRedeemRealisesProportionally() public {
        _yFund(alice, TEN_K);
        skip(90 days);
        vm.prank(alice);
        tenor.withdrawMargin(5_000e6);
        // 5,000 of VALUE = 5,000/price shares; those shares carried 5,000/price of principal (price at deposit = 1)
        uint256 p = vault.price();
        uint256 principalRemoved = 5_000e6 * 1e18 / p;
        assertApproxEqAbs(tenor.yieldRealized(alice), 5_000e6 - principalRemoved, 5, "realised = value - cost basis");
        assertApproxEqAbs(tenor.yieldPrincipal(alice), TEN_K - principalRemoved, 5, "principal reduced pro rata");
        assertApproxEqAbs(tenor.yieldEarned(alice), EARNED_90D, 5, "total earned unchanged by partial redeem");
    }

    // ------------------------- observed quirks (characterisation) -------------------------

    /// Regression: an empty vault must not reset the price. A first deposit after idle time earns nothing
    /// until time passes, and cycling deposit/full-redeem cannot drain the funded reserve.
    function test_EmptyVaultDepositEarnsNothingInstantly() public {
        skip(90 days);
        _yFund(alice, TEN_K);
        assertLe(tenor.yieldEarned(alice), 1, "no instant yield");
        uint256 reserveBefore = usdc.balanceOf(address(vault));
        for (uint256 i; i < 3; ++i) {
            _withdrawAll(alice);
            _deposit(alice, TEN_K);
        }
        assertGe(usdc.balanceOf(address(vault)) + 3, reserveBefore, "reserve not drained by cycling");
        skip(90 days);
        // simple-interest price: buying at an accrued price earns slightly less than 90d on par (~1.2 USDC here)
        assertApproxEqAbs(tenor.yieldEarned(alice), EARNED_90D, 1.5e6, "yield only from holding time");
        assertLt(tenor.yieldEarned(alice), EARNED_90D, "never more than the holding-time yield");
    }

    /// A deposit that would mint 0 shares (1 wei once price > 1) stays plain instead of reverting.
    function test_OneWeiDepositFallsBackToPlain() public {
        _yFund(carol, 1_000e6);
        skip(1 days);
        _yMode(alice, true);
        usdc.mint(alice, 1);
        vm.startPrank(alice);
        usdc.approve(address(tenor), 1);
        tenor.depositMargin(1);
        vm.stopPrank();
        assertEq(tenor.usdcBalance(alice), 1, "dust credited plain");
        assertEq(tenor.vaultShares(alice), 0);
    }

    // ------------------------------------- fuzz -------------------------------------

    function testFuzz_RoundTrip_AtPar(uint256 amt) public {
        amt = bound(amt, 1, 5_000_000e6);
        _yFund(alice, amt);
        uint256 got = _withdrawAll(alice);
        assertApproxEqAbs(got, amt, 2, "principal back within 2 wei");
        assertEq(usdc.balanceOf(address(tenor)), 0);
        assertEq(tenor.totalVaultShares(), 0);
        assertEq(tenor.vaultShares(alice), 0);
        assertEq(tenor.yieldPrincipal(alice), 0);
    }

    function testFuzz_RoundTrip_WithTimeAndOtherDepositor(uint256 amt, uint256 dt) public {
        amt = bound(amt, 2, 1_000e6); // >=2: 1 wei mints 0 shares once price > 1 (see test_Quirk_OneWeiDeposit...)
        dt = bound(dt, 0, 730 days);
        _yFund(carol, 1_000e6);
        skip(dt);
        _yFund(alice, amt);
        uint256 got = _withdrawAll(alice);
        assertApproxEqAbs(got, amt, 2, "same-block round trip loses only rounding");
        assertEq(usdc.balanceOf(address(tenor)), 0, "all value left in the vault belongs to carol");
        assertEq(tenor.totalVaultShares(), tenor.vaultShares(carol));
        assertEq(vault.balanceOf(address(tenor)), tenor.totalVaultShares());
    }

    function testFuzz_PartialWithdraw_PaysExactAndKeepsRemainder(uint256 amt, uint256 part, uint256 dt) public {
        amt = bound(amt, 2, 1_000e6);
        dt = bound(dt, 0, 365 days);
        _yFund(carol, 1_000e6);
        skip(dt);
        _yFund(alice, amt);
        uint256 before = tenor.freeMarginOf(alice); // may be amt-1: shares round down on deposit
        part = bound(part, 1, before);
        vm.prank(alice);
        tenor.withdrawMargin(part);
        assertEq(usdc.balanceOf(alice), part, "exact amount");
        assertApproxEqAbs(tenor.freeMarginOf(alice), before - part, 3, "remainder preserved");
        assertEq(vault.balanceOf(address(tenor)), tenor.totalVaultShares());
        assertEq(tenor.totalVaultShares(), tenor.vaultShares(alice) + tenor.vaultShares(carol));
    }
}
