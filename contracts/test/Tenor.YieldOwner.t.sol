// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {TenorYieldBase, ToggleVault} from "./Tenor.Yield.t.sol";
import {Tenor} from "../Tenor.sol";
import {MockYieldVault} from "../MockYieldVault.sol";

/// @dev (7): owner controls over the optional yield vault.
contract TenorYieldOwnerTest is TenorYieldBase {
    // ------------------------------ access control ------------------------------

    function test_Owner_NonOwnerCannotSetVaultOrPause() public {
        address[3] memory callers = [stranger, alice, address(vault)];
        for (uint256 i; i < callers.length; ++i) {
            vm.startPrank(callers[i]);
            vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, callers[i]));
            tenor.setYieldVault(address(0));
            vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, callers[i]));
            tenor.setYieldDepositsPaused(true);
            vm.stopPrank();
        }
        assertEq(address(tenor.yieldVault()), address(vault));
        assertFalse(tenor.yieldDepositsPaused());
    }

    function test_Owner_SetYieldVaultEmitsAndApplies() public {
        ToggleVault v2 = new ToggleVault(owner, IERC20(USDC_ADDR));
        vm.expectEmit(true, false, false, false, address(tenor));
        emit Tenor.YieldVaultSet(address(v2));
        vm.prank(owner);
        tenor.setYieldVault(address(v2));
        assertEq(address(tenor.yieldVault()), address(v2));
        // new deposits route to the new vault
        _yFund(alice, 10e6);
        assertEq(v2.depositCalls(), 1);
        assertEq(vault.depositCalls(), 0);
        assertEq(v2.balanceOf(address(tenor)), 10e6);
    }

    function test_Owner_PauseEmitsAndToggles() public {
        vm.expectEmit(false, false, false, true, address(tenor));
        emit Tenor.YieldDepositsPausedSet(true);
        _pause(true);
        assertTrue(tenor.yieldDepositsPaused());
        assertFalse(tenor.yieldActive());
        vm.expectEmit(false, false, false, true, address(tenor));
        emit Tenor.YieldDepositsPausedSet(false);
        _pause(false);
        assertTrue(tenor.yieldActive());
    }

    function test_Owner_TransferredOwnerGainsAndOldOwnerLosesControl() public {
        address owner2 = makeAddr("owner2");
        vm.prank(owner);
        tenor.transferOwnership(owner2);
        vm.prank(owner2);
        tenor.acceptOwnership();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, owner));
        tenor.setYieldDepositsPaused(true);
        vm.prank(owner2);
        tenor.setYieldDepositsPaused(true);
        assertTrue(tenor.yieldDepositsPaused());
    }

    // ------------------------------ in-use guard ------------------------------

    function test_Owner_CannotChangeVaultWhileSharesExist() public {
        _yFund(alice, 100e6);
        ToggleVault v2 = new ToggleVault(owner, IERC20(USDC_ADDR));
        vm.startPrank(owner);
        vm.expectRevert(Tenor.YieldVaultInUse.selector);
        tenor.setYieldVault(address(0));
        vm.expectRevert(Tenor.YieldVaultInUse.selector);
        tenor.setYieldVault(address(v2));
        vm.expectRevert(Tenor.YieldVaultInUse.selector);
        tenor.setYieldVault(address(vault)); // even re-setting the same vault
        vm.stopPrank();
        assertEq(address(tenor.yieldVault()), address(vault));
        assertEq(tenor.vaultShares(alice), 100e6, "owner cannot strand user shares");
    }

    function test_Owner_GuardChecksBeforeAssetValidation() public {
        _yFund(alice, 1e6);
        vm.prank(owner);
        vm.expectRevert(Tenor.YieldVaultInUse.selector);
        tenor.setYieldVault(address(feed)); // not even a vault: in-use reported first
    }

    function test_Owner_CanDisableVaultOnceAllSharesRedeemed() public {
        _yFund(alice, 100e6);
        _withdrawAll(alice);
        assertEq(tenor.totalVaultShares(), 0);
        vm.prank(owner);
        tenor.setYieldVault(address(0));
        assertEq(address(tenor.yieldVault()), address(0));
        assertFalse(tenor.yieldActive());
        // v1 behaviour restored: cannot opt in
        vm.prank(bob);
        vm.expectRevert(Tenor.YieldUnavailable.selector);
        tenor.setYieldMode(true);
        vm.prank(alice);
        vm.expectRevert(Tenor.YieldUnavailable.selector);
        tenor.sweepToYield();
        // alice's stale opt-in flag no longer routes anywhere: deposits stay plain
        assertTrue(tenor.yieldMode(alice));
        _deposit(alice, 5e6);
        assertEq(tenor.usdcBalance(alice), 5e6);
        assertEq(tenor.vaultValueOf(alice), 0);
        assertEq(tenor.freeMarginOf(alice), 5e6);
        // and she can still leave
        _yMode(alice, false);
        assertFalse(tenor.yieldMode(alice));
    }

    function test_Owner_CanDisableVaultAfterOptOutRedeemsAll() public {
        _yFund(alice, 100e6);
        _yMode(alice, false);
        vm.prank(owner);
        tenor.setYieldVault(address(0));
        assertEq(tenor.usdcBalance(alice), 100e6, "user funds untouched");
    }

    function test_Owner_OwnerActionsNeverChangeUserBalances() public {
        _yFund(alice, 100e6);
        _deposit(bob, 50e6);
        uint256 a = tenor.freeMarginOf(alice);
        uint256 b = tenor.freeMarginOf(bob);
        uint256 held = usdc.balanceOf(address(tenor));
        _pause(true);
        _pause(false);
        vm.prank(owner);
        vm.expectRevert(Tenor.YieldVaultInUse.selector);
        tenor.setYieldVault(address(0));
        assertEq(tenor.freeMarginOf(alice), a);
        assertEq(tenor.freeMarginOf(bob), b);
        assertEq(usdc.balanceOf(address(tenor)), held);
        assertEq(tenor.vaultShares(alice), 100e6);
    }

    // ------------------------------ asset validation ------------------------------

    function test_Owner_WrongAssetVaultRejected() public {
        MockYieldVault wrong = new MockYieldVault(owner, IERC20(address(eurc)));
        vm.prank(owner);
        vm.expectRevert(Tenor.ParamOutOfBounds.selector);
        tenor.setYieldVault(address(wrong));
        assertEq(address(tenor.yieldVault()), address(vault), "unchanged");
    }

    function test_Owner_NonVaultContractRejected() public {
        // MockAggregator has no asset(): the staticcall reverts and is mapped to ParamOutOfBounds
        vm.prank(owner);
        vm.expectRevert(Tenor.ParamOutOfBounds.selector);
        tenor.setYieldVault(address(feed));
    }

    function test_Owner_EoaVaultRejected() public {
        // An EOA fails Solidity's extcodesize check, which try/catch does not catch: plain revert (not ParamOutOfBounds).
        vm.prank(owner);
        vm.expectRevert();
        tenor.setYieldVault(makeAddr("eoa"));
        assertEq(address(tenor.yieldVault()), address(vault));
    }

    function test_Owner_ConstructorRejectsWrongAssetVault() public {
        MockYieldVault wrong = new MockYieldVault(owner, IERC20(address(eurc)));
        address[] memory ds = new address[](0);
        vm.expectRevert(Tenor.ParamOutOfBounds.selector);
        new Tenor(owner, address(eurc), address(feed), RUSD, REUR, ds, address(wrong));
    }

    function test_Owner_ConstructorAcceptsZeroVault() public {
        address[] memory ds = new address[](0);
        Tenor t = new Tenor(owner, address(eurc), address(feed), RUSD, REUR, ds, address(0));
        assertFalse(t.yieldActive());
    }

    function test_Owner_SetVaultLaterEnablesYield() public {
        address[] memory ds = new address[](0);
        Tenor t = new Tenor(owner, address(eurc), address(feed), RUSD, REUR, ds, address(0));
        vm.prank(owner);
        t.setYieldVault(address(vault));
        assertTrue(t.yieldActive());
        vm.prank(alice);
        t.setYieldMode(true);
        assertTrue(t.yieldMode(alice));
    }

    // ------------------------------ pause switch ------------------------------

    function test_Pause_StopsNewDepositsButNeverRedemptions() public {
        _yFund(alice, 1_000e6);
        _pause(true);

        // new deposits: accepted, but plain
        usdc.mint(alice, 40e6);
        vm.startPrank(alice);
        usdc.approve(address(tenor), 40e6);
        tenor.depositMargin(40e6);
        vm.stopPrank();
        assertEq(tenor.usdcBalance(alice), 40e6);
        assertEq(tenor.vaultShares(alice), 1_000e6, "no new shares");

        // no new opt-ins / sweeps
        vm.prank(bob);
        vm.expectRevert(Tenor.YieldUnavailable.selector);
        tenor.setYieldMode(true);
        vm.prank(alice);
        vm.expectRevert(Tenor.YieldUnavailable.selector);
        tenor.sweepToYield();

        // redemptions: withdrawMargin over the plain part redeems from the vault
        uint256 redeemsBefore = vault.redeemCalls();
        vm.prank(alice);
        tenor.withdrawMargin(100e6);
        assertEq(usdc.balanceOf(alice), 100e6);
        assertGt(vault.redeemCalls(), redeemsBefore, "redeemed while paused");

        // opting out redeems everything while paused
        _yMode(alice, false);
        assertEq(tenor.vaultShares(alice), 0);
        // and withdraw pays it all out
        _withdrawAll(alice);
        assertEq(usdc.balanceOf(alice), 1_040e6);
        assertEq(tenor.totalVaultShares(), 0);
    }

    function test_Pause_TradingStillRedeemsOnDemand() public {
        _yFund(hedger, 100e6);
        _yFund(dealer, 100e6);
        _pause(true);
        Tenor.Quote memory q = _mkQuote(Tenor.Side.SELL_USD, N, 30 days, false);
        bytes memory sig = _sign(dealerPk, q);
        vm.prank(hedger);
        uint256 id = tenor.open(q, sig);
        assertEq(tenor.getTrade(id).hedgerMargin, IM);
        assertEq(tenor.vaultShares(hedger), 100e6 - IM);
        vm.prank(hedger);
        tenor.topUp(id, 1e6);
        assertEq(tenor.vaultShares(hedger), 100e6 - IM - 1e6);
    }

    function test_Pause_YieldKeepsAccruingOnExistingShares() public {
        _yFund(alice, 10_000e6);
        _pause(true);
        skip(90 days);
        assertApproxEqAbs(tenor.yieldEarned(alice), 110_958_904, 3);
    }

    function test_Pause_UnpauseResumesRouting() public {
        _yMode(alice, true);
        _pause(true);
        _deposit(alice, 10e6);
        assertEq(tenor.usdcBalance(alice), 10e6);
        _pause(false);
        _deposit(alice, 20e6);
        assertEq(tenor.vaultShares(alice), 20e6);
        vm.prank(alice);
        tenor.sweepToYield();
        assertEq(tenor.vaultShares(alice), 30e6);
        assertEq(tenor.usdcBalance(alice), 0);
    }

    function test_Pause_CanPauseBeforeAnyoneOptsIn() public {
        _pause(true);
        vm.prank(alice);
        vm.expectRevert(Tenor.YieldUnavailable.selector);
        tenor.setYieldMode(true);
    }
}
