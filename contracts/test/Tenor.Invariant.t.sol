// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {console2} from "forge-std/Test.sol";
import {TenorTestBase} from "./Tenor.Base.t.sol";
import {TenorHandler} from "./Tenor.Handler.t.sol";
import {Tenor} from "../Tenor.sol";

/// forge-config: default.invariant.runs = 256
/// forge-config: default.invariant.depth = 200
/// forge-config: default.invariant.fail_on_revert = false
contract TenorInvariantTest is TenorTestBase {
    TenorHandler internal handler;

    function setUp() public override {
        super.setUp();
        address[3] memory hs = [hedger, bob, carol];
        address[2] memory ds = [dealer, dealer2];
        uint256[2] memory ks = [dealerPk, dealer2Pk];
        handler = new TenorHandler(tenor, usdc, eurc, feed, owner, hs, ds, ks);
        targetContract(address(handler));
    }

    function _sumUsers(bool isUsdc) internal view returns (uint256 sum) {
        for (uint256 i; i < 5; ++i) {
            address u = handler.users(i);
            sum += isUsdc ? tenor.usdcBalance(u) : tenor.eurcBalance(u);
        }
    }

    /// USDC: all users' free credits + all trades' margins + funded USD legs == Tenor's USDC.
    function invariant_UsdcSolvency() public view {
        uint256 sum = _sumUsers(true);
        for (uint256 id = 1; id < tenor.nextTradeId(); ++id) {
            Tenor.Trade memory t = tenor.getTrade(id);
            sum += t.hedgerMargin + t.dealerMargin + t.usdLegAmount;
        }
        assertEq(usdc.balanceOf(address(tenor)), sum, "USDC solvency (exact)");
    }

    /// EURC: all users' EURC credits + funded EUR legs == Tenor's EURC.
    function invariant_EurcSolvency() public view {
        uint256 sum = _sumUsers(false);
        for (uint256 id = 1; id < tenor.nextTradeId(); ++id) {
            sum += tenor.getTrade(id).eurLegAmount;
        }
        assertEq(eurc.balanceOf(address(tenor)), sum, "EURC solvency (exact)");
    }

    /// mark() only shifts value between the two parties of one trade.
    function invariant_VariationMarginZeroSum() public view {
        assertFalse(handler.vmViolation(), "mark changed hedgerMargin+dealerMargin");
    }

    /// Terminal trades hold nothing and have no open call; open trades' legs are bounded by principal.
    function invariant_TerminalTradesAreEmpty() public view {
        for (uint256 id = 1; id < tenor.nextTradeId(); ++id) {
            Tenor.Trade memory t = tenor.getTrade(id);
            if (t.status != Tenor.Status.Open) {
                assertEq(t.hedgerMargin + t.dealerMargin, 0, "margin left in terminal trade");
                assertEq(t.usdLegAmount + t.eurLegAmount, 0, "leg left in terminal trade");
                assertEq(t.callParty, 0);
            } else {
                assertLe(t.usdLegAmount, t.notionalUsd6);
                assertLe(t.eurLegAmount, t.eurAmount6);
                assertEq(t.usdLegAmount != 0, t.usdLegFunded);
                assertEq(t.eurLegAmount != 0, t.eurLegFunded);
            }
        }
    }

    /// On PHYSICAL trades withdrawExcess locks received VM, so the VM receiver always holds at least its receipts
    /// (this is what guarantees the delivery-time unwind can never underflow). Cash trades may withdraw gains.
    function invariant_PhysicalVmReceiverHoldsReceipts() public view {
        for (uint256 id = 1; id < tenor.nextTradeId(); ++id) {
            Tenor.Trade memory t = tenor.getTrade(id);
            if (t.status != Tenor.Status.Open || t.cashSettled) continue;
            int256 m = t.lastMtmHedger;
            if (m >= 0) assertGe(t.hedgerMargin, uint256(m), "hedger holds VM it received");
            else assertGe(t.dealerMargin, uint256(-m), "dealer holds VM it received");
        }
    }

    function afterInvariant() public view {
        // coverage hint, visible with -vv on the final run
        console2.log("open/mark/calls", handler.nOpen(), handler.nMark(), handler.nCalls());
        console2.log("closeOut/delivered/failed/cash", handler.nCloseOut(), handler.nDelivered(), handler.nFailed());
    }
}
