// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Tenor} from "../Tenor.sol";
import {MockAggregator} from "../MockAggregator.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockEURC} from "./mocks/MockEURC.sol";

/// @dev Bounded action surface for stateful invariant testing. Contains no test/invariant functions.
contract TenorHandler is Test {
    Tenor public tenor;
    MockUSDC public usdc;
    MockEURC public eurc;
    MockAggregator public feed;
    address public oracleOwner;

    address[5] public users; // 0..2 hedgers, 3..4 dealers
    uint256[2] internal dealerKeys;
    uint256 public spot = 1.10e8;
    uint256 public nonce;

    bool public vmViolation;
    // coverage counters
    uint256 public nOpen;
    uint256 public nMark;
    uint256 public nCalls;
    uint256 public nCloseOut;
    uint256 public nDelivered;
    uint256 public nFailed;
    uint256 public nCash;
    uint256 public nFund;

    constructor(
        Tenor t, MockUSDC u, MockEURC e, MockAggregator f, address oracleOwner_,
        address[3] memory hedgers, address[2] memory dealers_, uint256[2] memory keys
    ) {
        tenor = t;
        usdc = u;
        eurc = e;
        feed = f;
        oracleOwner = oracleOwner_;
        for (uint256 i; i < 3; ++i) users[i] = hedgers[i];
        for (uint256 i; i < 2; ++i) users[3 + i] = dealers_[i];
        dealerKeys = keys;
        for (uint256 i; i < 5; ++i) {
            usdc.mint(users[i], 1e24);
            eurc.mint(users[i], 1e24);
            vm.startPrank(users[i]);
            usdc.approve(address(tenor), type(uint256).max);
            eurc.approve(address(tenor), type(uint256).max);
            vm.stopPrank();
        }
    }

    function _user(uint256 seed) internal view returns (address) {
        return users[seed % 5];
    }

    function _tradeId(uint256 seed) internal view returns (uint256) {
        uint256 n = tenor.nextTradeId();
        return n == 1 ? 0 : 1 + (seed % (n - 1));
    }

    function _ensure(address who, uint256 needed) internal {
        uint256 bal = tenor.usdcBalance(who);
        if (bal >= needed) return;
        vm.prank(who);
        tenor.depositMargin(needed - bal);
    }

    // ------------------------------------ free balances ------------------------------------

    function deposit(uint256 who, uint256 amt) external {
        amt = bound(amt, 1, 100e6);
        vm.prank(_user(who));
        tenor.depositMargin(amt);
    }

    function withdrawSome(uint256 who, uint256 amt) external {
        address u = _user(who);
        amt = bound(amt, 0, tenor.usdcBalance(u));
        vm.prank(u);
        tenor.withdrawMargin(amt);
    }

    function withdrawAll(uint256 who) external {
        vm.prank(_user(who));
        tenor.withdraw();
    }

    function withdrawEurc(uint256 who) external {
        vm.prank(_user(who));
        tenor.withdrawEurc();
    }

    // ---------------------------------------- market ----------------------------------------

    function setPrice(uint256 p) external {
        spot = bound(p, 0.5e8, 2.0e8);
        vm.prank(oracleOwner);
        feed.setAnswer(int256(spot));
    }

    function warp(uint256 dt) external {
        dt = bound(dt, 1, 4 days);
        vm.warp(block.timestamp + dt);
        vm.prank(oracleOwner);
        feed.setAnswer(int256(spot)); // keep the oracle fresh
    }

    // ----------------------------------------- trades -----------------------------------------

    function open(uint256 h, uint256 d, uint256 sideSeed, uint256 notional, uint256 tenorSecs, bool cash, uint256 offset)
        external
    {
        notional = bound(notional, 1e6, 50e6);
        tenorSecs = bound(tenorSecs, 300, 10 days);
        uint256 di = d % 2;
        address dealer_ = users[3 + di];
        address hedger_ = users[h % 3];
        (, uint256 fair,,,) = tenor.quote(notional, tenorSecs);
        Tenor.Quote memory q = Tenor.Quote({
            dealer: dealer_,
            side: uint8(sideSeed % 2),
            notionalUsd6: notional,
            rate: (fair * (9_960 + bound(offset, 0, 80))) / 10_000,
            maturity: block.timestamp + tenorSecs,
            initialMarginBps: 500,
            quoteExpiry: block.timestamp + 1,
            nonce: ++nonce,
            cashSettled: cash
        });
        uint256 margin = (notional * 500 + 9_999) / 10_000;
        _ensure(hedger_, margin);
        _ensure(dealer_, margin);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(dealerKeys[di], tenor.hashQuote(q));
        vm.prank(hedger_);
        tenor.open(q, abi.encodePacked(r, s, v));
        ++nOpen;
        if (cash) ++nCash;
    }

    function mark(uint256 seed) external {
        uint256 id = _tradeId(seed);
        if (id == 0) return;
        Tenor.Trade memory b = tenor.getTrade(id);
        tenor.mark(id);
        Tenor.Trade memory a = tenor.getTrade(id);
        if (a.hedgerMargin + a.dealerMargin != b.hedgerMargin + b.dealerMargin) vmViolation = true;
        ++nMark;
        if (a.callParty != 0) ++nCalls;
    }

    function topUp(uint256 seed, uint256 party, uint256 amt) external {
        uint256 id = _tradeId(seed);
        if (id == 0) return;
        Tenor.Trade memory t = tenor.getTrade(id);
        address who = party % 2 == 0 ? t.hedger : t.dealer;
        amt = bound(amt, 1, 60e6);
        _ensure(who, amt);
        vm.prank(who);
        tenor.topUp(id, amt);
    }

    function withdrawExcess(uint256 seed, uint256 party, uint256 amt) external {
        uint256 id = _tradeId(seed);
        if (id == 0) return;
        Tenor.Trade memory t = tenor.getTrade(id);
        address who = party % 2 == 0 ? t.hedger : t.dealer;
        uint256 m = party % 2 == 0 ? t.hedgerMargin : t.dealerMargin;
        amt = bound(amt, 0, m);
        vm.prank(who);
        tenor.withdrawExcess(id, amt);
    }

    function closeOut(uint256 seed) external {
        uint256 id = _tradeId(seed);
        if (id == 0) return;
        tenor.closeOut(id);
        ++nCloseOut;
    }

    function fundLeg(uint256 seed, uint256 party) external {
        uint256 id = _tradeId(seed);
        if (id == 0) return;
        Tenor.Trade memory t = tenor.getTrade(id);
        vm.prank(party % 2 == 0 ? t.hedger : t.dealer);
        tenor.fundLeg(id);
        ++nFund;
    }

    function settle(uint256 seed) external {
        uint256 id = _tradeId(seed);
        if (id == 0) return;
        tenor.settle(id);
        Tenor.Status s = tenor.getTrade(id).status;
        if (s == Tenor.Status.Delivered) ++nDelivered;
        else if (s == Tenor.Status.DeliveryFailed) ++nFailed;
    }

    /// Drives a trade to/after maturity, optionally funds legs, then settles (steers fuzzing into settlement paths).
    function matureAndSettle(uint256 seed, bool fundHedgerLeg, bool fundDealerLeg, uint256 extraWait) external {
        uint256 id = _tradeId(seed);
        if (id == 0) return;
        Tenor.Trade memory t = tenor.getTrade(id);
        if (t.status != Tenor.Status.Open) return;
        if (block.timestamp < t.maturity) {
            vm.warp(t.maturity);
            vm.prank(oracleOwner);
            feed.setAnswer(int256(spot));
        }
        if (fundHedgerLeg) {
            vm.prank(t.hedger);
            try tenor.fundLeg(id) {++nFund;} catch {}
        }
        if (fundDealerLeg) {
            vm.prank(t.dealer);
            try tenor.fundLeg(id) {++nFund;} catch {}
        }
        extraWait = bound(extraWait, 0, 300);
        if (extraWait != 0) {
            vm.warp(block.timestamp + extraWait);
            vm.prank(oracleOwner);
            feed.setAnswer(int256(spot));
        }
        try tenor.settle(id) {
            Tenor.Status s = tenor.getTrade(id).status;
            if (s == Tenor.Status.Delivered) ++nDelivered;
            else if (s == Tenor.Status.DeliveryFailed) ++nFailed;
        } catch {}
    }

    function cancelNonce(uint256 who, uint256 n) external {
        vm.prank(_user(who));
        tenor.cancelNonce(bound(n, 1, nonce + 3));
    }

    // ------------------------------------- views for invariants -------------------------------------

    function usersLength() external pure returns (uint256) {
        return 5;
    }
}
