// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {TenorTestBase} from "./Tenor.Base.t.sol";
import {Tenor} from "../Tenor.sol";
import {MockAggregator} from "../MockAggregator.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract EighteenDecimalFeed {
    function decimals() external pure returns (uint8) {
        return 18;
    }
}

/// @dev Owner powers: config only, never custody. Enumerates every owner-gated function.
contract TenorOwnerTest is TenorTestBase {
    address internal owner2 = makeAddr("owner2");
    uint256 internal idPhys;
    uint256 internal idCash;

    function setUp() public override {
        super.setUp();
        // Rich state: physical trade (one leg funded, marked, called) + cash trade (marked) + free balances + credits.
        idPhys = _openTrade(Tenor.Side.SELL_USD, false);
        Tenor.Quote memory q = _mkQuote(Tenor.Side.BUY_USD, 20e6, 20 days, true);
        q.dealer = dealer2;
        _fund(bob, 1e6);
        _fund(dealer2, 1e6);
        vm.prank(bob);
        idCash = tenor.open(q, _sign(dealer2Pk, q));
        _fund(carol, 777_777); // free balance, no trade
        vm.warp(T0 + 61);
        _setSpot(1.15e8);
        tenor.mark(idPhys); // creates a margin call
        tenor.mark(idCash);
        // a physical delivery to get an EURC credit and an escrowed leg
        Tenor.Quote memory q3 = _mkQuote(Tenor.Side.SELL_USD, 5e6, 300, false);
        q3.dealer = dealer2;
        _fund(carol, 250_000);
        _fund(dealer2, 250_000);
        vm.prank(carol);
        uint256 id3 = tenor.open(q3, _sign(dealer2Pk, q3));
        vm.warp(block.timestamp + 300);
        _setSpot(1.15e8);
        _wallet(carol, 5e6, 0);
        vm.prank(carol);
        tenor.fundLeg(id3); // escrowed USDC leg held by Tenor
    }

    function _users() internal view returns (address[8] memory u) {
        u = [hedger, dealer, dealer2, bob, carol, owner, owner2, stranger];
    }

    /// Hash of everything owned by users: token balances of Tenor, user credits and all trades.
    function _snapshot() internal view returns (bytes32 h) {
        bytes memory acc = abi.encode(usdc.balanceOf(address(tenor)), eurc.balanceOf(address(tenor)));
        address[8] memory u = _users();
        for (uint256 i; i < u.length; ++i) {
            acc = abi.encodePacked(acc, tenor.usdcBalance(u[i]), tenor.eurcBalance(u[i]), usdc.balanceOf(u[i]), eurc.balanceOf(u[i]));
        }
        for (uint256 id = 1; id < tenor.nextTradeId(); ++id) {
            acc = abi.encodePacked(acc, keccak256(abi.encode(tenor.getTrade(id))));
        }
        h = keccak256(acc);
    }

    function test_Snapshot_IsSensitive() public {
        bytes32 s0 = _snapshot();
        _fund(stranger, 1);
        assertTrue(_snapshot() != s0, "sanity: snapshot detects balance changes");
    }

    function test_Owner_SetFeed_DoesNotTouchFunds() public {
        bytes32 s0 = _snapshot();
        MockAggregator f2 = new MockAggregator(owner, 1.3e8);
        vm.prank(owner);
        tenor.setFeed(address(f2));
        assertEq(address(tenor.feed()), address(f2));
        assertEq(_snapshot(), s0);
    }

    function test_Owner_SetRates_DoesNotTouchFunds() public {
        bytes32 s0 = _snapshot();
        vm.startPrank(owner);
        tenor.setRates(0.5e18, 0);
        assertEq(_snapshot(), s0);
        tenor.setRates(0, 0.5e18);
        assertEq(_snapshot(), s0);
        tenor.setRates(0, 0);
        assertEq(_snapshot(), s0);
        vm.stopPrank();
    }

    function test_Owner_SetDealer_DoesNotTouchFunds() public {
        bytes32 s0 = _snapshot();
        vm.startPrank(owner);
        tenor.setDealer(dealer, false);
        tenor.setDealer(dealer2, false);
        tenor.setDealer(owner2, true);
        vm.stopPrank();
        assertEq(_snapshot(), s0, "de-listing a dealer leaves its open trades and balances intact");
    }

    function test_Owner_SetRiskParams_DoesNotTouchFunds_AndTradeSnapshotsHold() public {
        bytes32 s0 = _snapshot();
        Tenor.Trade memory before_ = tenor.getTrade(idPhys);
        vm.startPrank(owner);
        tenor.setRiskParams(Tenor.RiskParams(5_000, 4_999, 500, 1 days, 7 days, 7 days, 365 days, 10_000_000e6, 7 days));
        assertEq(_snapshot(), s0);
        tenor.setRiskParams(Tenor.RiskParams(100, 50, 1, 10, 30, 30, 60, 1, 60));
        vm.stopPrank();
        assertEq(_snapshot(), s0);
        Tenor.Trade memory after_ = tenor.getTrade(idPhys);
        assertEq(after_.maintenanceBps, before_.maintenanceBps);
        assertEq(after_.cureWindow, before_.cureWindow);
        assertEq(after_.deliveryGrace, before_.deliveryGrace);
        assertEq(after_.initialMarginUsd6, before_.initialMarginUsd6);
        assertEq(after_.hedgerMargin, before_.hedgerMargin);
    }

    function test_Owner_OwnershipFunctions_DoNotTouchFunds() public {
        bytes32 s0 = _snapshot();
        vm.prank(owner);
        tenor.transferOwnership(owner2);
        assertEq(_snapshot(), s0);
        vm.prank(owner2);
        tenor.acceptOwnership();
        assertEq(tenor.owner(), owner2);
        assertEq(_snapshot(), s0);
        vm.prank(owner2);
        tenor.renounceOwnership();
        assertEq(tenor.owner(), address(0));
        assertEq(_snapshot(), s0);
    }

    function test_Owner_HasNoWithdrawalPath() public {
        bytes32 s0 = _snapshot();
        // Owner calls every user-facing exit with their own (empty) account: nothing of others moves.
        vm.startPrank(owner);
        tenor.withdraw();
        tenor.withdrawEurc();
        vm.expectRevert(Tenor.InsufficientMargin.selector);
        tenor.withdrawMargin(1);
        vm.expectRevert(Tenor.NotParty.selector);
        tenor.withdrawExcess(idPhys, 0);
        vm.expectRevert(Tenor.NotParty.selector);
        tenor.topUp(idPhys, 1);
        vm.expectRevert(Tenor.NotParty.selector);
        tenor.fundLeg(idPhys);
        vm.stopPrank();
        assertEq(_snapshot(), s0);
        assertEq(usdc.balanceOf(owner), 0);
        assertEq(eurc.balanceOf(owner), 0);
    }

    function test_Owner_ValuationTrustAssumption_OnlyShiftsVmInsideTrade() public {
        // A malicious oracle/rates can reprice VM between the two counterparties of a trade,
        // but cannot create or remove collateral or touch anyone else's balance.
        MockAggregator f2 = new MockAggregator(owner, 100e8);
        vm.prank(owner);
        tenor.setFeed(address(f2));
        vm.prank(owner);
        tenor.setRates(0.5e18, 0);
        uint256 tradeSumBefore = tenor.getTrade(idCash).hedgerMargin + tenor.getTrade(idCash).dealerMargin;
        uint256 usdcBefore = usdc.balanceOf(address(tenor));
        vm.warp(block.timestamp + 61);
        vm.prank(owner);
        f2.setAnswer(100e8);
        tenor.mark(idCash);
        uint256 tradeSumAfter = tenor.getTrade(idCash).hedgerMargin + tenor.getTrade(idCash).dealerMargin;
        assertEq(tradeSumAfter, tradeSumBefore);
        assertEq(usdc.balanceOf(address(tenor)), usdcBefore);
        assertEq(tenor.usdcBalance(carol), 777_777, "unrelated free balance untouched");
    }

    // ------------------------------- access control + bounds -------------------------------

    function test_NonOwner_CannotCallAnyOwnerFunction() public {
        bytes memory err = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger);
        vm.startPrank(stranger);
        vm.expectRevert(err);
        tenor.setFeed(address(feed));
        vm.expectRevert(err);
        tenor.setRates(0, 0);
        vm.expectRevert(err);
        tenor.setDealer(stranger, true);
        vm.expectRevert(err);
        tenor.setRiskParams(Tenor.RiskParams(500, 300, 50, 60, 120, 120, 300, 50e6, 90_000));
        vm.expectRevert(err);
        tenor.transferOwnership(stranger);
        vm.expectRevert(err);
        tenor.renounceOwnership();
        vm.stopPrank();
        // acceptOwnership only works for the pending owner
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        tenor.acceptOwnership();
    }

    function test_Owner_ParameterBounds() public {
        address eoa = makeAddr("eoa");
        address badFeed = address(new EighteenDecimalFeed());
        vm.startPrank(owner);
        vm.expectRevert(Tenor.ParamOutOfBounds.selector);
        tenor.setRates(0.5e18 + 1, 0);
        vm.expectRevert(Tenor.ParamOutOfBounds.selector);
        tenor.setRates(0, 0.5e18 + 1);
        vm.expectRevert(Tenor.ZeroAddress.selector);
        tenor.setDealer(address(0), true);
        vm.expectRevert(Tenor.ZeroAddress.selector);
        tenor.setFeed(address(0));
        vm.expectRevert(Tenor.ParamOutOfBounds.selector);
        tenor.setFeed(badFeed);
        vm.expectRevert(); // EOA: no code to call
        tenor.setFeed(eoa);
        // maintenance must be strictly below initial
        vm.expectRevert(Tenor.ParamOutOfBounds.selector);
        tenor.setRiskParams(Tenor.RiskParams(500, 500, 50, 60, 120, 120, 300, 50e6, 90_000));
        vm.expectRevert(Tenor.ParamOutOfBounds.selector);
        tenor.setRiskParams(Tenor.RiskParams(99, 50, 50, 60, 120, 120, 300, 50e6, 90_000));
        vm.expectRevert(Tenor.ParamOutOfBounds.selector);
        tenor.setRiskParams(Tenor.RiskParams(500, 300, 501, 60, 120, 120, 300, 50e6, 90_000));
        vm.expectRevert(Tenor.ParamOutOfBounds.selector);
        tenor.setRiskParams(Tenor.RiskParams(500, 300, 50, 60, 120, 120, 300, 0, 90_000));
        vm.expectRevert(Tenor.ParamOutOfBounds.selector);
        tenor.setRiskParams(Tenor.RiskParams(500, 300, 50, 60, 120, 120, 300, 50e6, 59));
        vm.stopPrank();
    }

    function test_Owner_Constructor_Reverts() public {
        address[] memory ds = new address[](0);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new Tenor(address(0), address(eurc), address(feed), 0, 0, ds, address(0));
        vm.expectRevert(Tenor.ZeroAddress.selector);
        new Tenor(owner, address(0), address(feed), 0, 0, ds, address(0));
        vm.expectRevert(Tenor.ParamOutOfBounds.selector);
        new Tenor(owner, USDC_ADDR, address(feed), 0, 0, ds, address(0));
        vm.expectRevert(Tenor.ParamOutOfBounds.selector);
        new Tenor(owner, address(eurc), address(feed), 0.5e18 + 1, 0, ds, address(0));
    }
}
