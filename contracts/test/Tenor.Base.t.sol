// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Tenor} from "../Tenor.sol";
import {MockAggregator} from "../MockAggregator.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockEURC} from "./mocks/MockEURC.sol";

/// @dev Shared fixtures + independent reference maths. No test functions here.
abstract contract TenorTestBase is Test {
    address internal constant USDC_ADDR = 0x3600000000000000000000000000000000000000;
    uint256 internal constant T0 = 1_700_000_000;
    uint256 internal constant YEAR = 365 days;
    uint256 internal constant SPOT = 1.10e8; // 8dp EUR/USD
    uint256 internal constant RUSD = 0.045e18;
    uint256 internal constant REUR = 0.025e18;
    uint256 internal constant N = 10e6; // default notional (10 USDC)
    uint256 internal constant IM = 500_000; // 5% of N
    uint256 internal constant MAINT = 300_000; // 3% of N

    Tenor internal tenor;
    MockUSDC internal usdc;
    MockEURC internal eurc;
    MockAggregator internal feed;

    address internal owner = makeAddr("owner");
    address internal hedger = makeAddr("hedger");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal stranger = makeAddr("stranger");
    address internal dealer;
    uint256 internal dealerPk;
    address internal dealer2;
    uint256 internal dealer2Pk;
    uint256 internal nonceCtr;

    function setUp() public virtual {
        vm.warp(T0);
        deployCodeTo("MockUSDC.sol:MockUSDC", USDC_ADDR);
        usdc = MockUSDC(USDC_ADDR);
        eurc = new MockEURC();
        (dealer, dealerPk) = makeAddrAndKey("dealer");
        (dealer2, dealer2Pk) = makeAddrAndKey("dealer2");
        feed = new MockAggregator(owner, int256(SPOT));
        address[] memory ds = new address[](2);
        ds[0] = dealer;
        ds[1] = dealer2;
        tenor = new Tenor(owner, address(eurc), address(feed), RUSD, REUR, ds, address(0));
        // v1 test fixture: pin the original 120s cure window / delivery grace (v2 defaults are 300s / 900s).
        vm.prank(owner);
        tenor.setRiskParams(Tenor.RiskParams(500, 300, 50, 60, 120, 120, 300, 50e6, 90_000));
    }

    // ----------------------------- reference maths (independent) -----------------------------

    /// Covered interest parity: F = S * (1 + rUsd*T) / (1 + rEur*T), simple interest, 365d year.
    function _fair(uint256 spot8, uint256 tenorSecs, uint256 rU, uint256 rE) internal pure returns (uint256) {
        uint256 num = 1e18 + (rU * tenorSecs) / YEAR;
        uint256 den = 1e18 + (rE * tenorSecs) / YEAR;
        return (spot8 * 1e10 * num) / den;
    }

    function _ceilBps(uint256 amount, uint256 bps) internal pure returns (uint256) {
        return (amount * bps + 9_999) / 10_000;
    }

    function _spotNow() internal view returns (uint256 s) {
        (, int256 a,,,) = feed.latestRoundData();
        s = uint256(a);
    }

    function _remaining(Tenor.Trade memory t) internal view returns (uint256) {
        return t.maturity > block.timestamp ? t.maturity - block.timestamp : 0;
    }

    /// Hedger MTM (USD6): magnitude N*|F-R|/R rounded down; positive if hedger is long EUR and F>R.
    function _mtmHedger(uint256 id) internal view returns (int256) {
        Tenor.Trade memory t = tenor.getTrade(id);
        uint256 f = _fair(_spotNow(), _remaining(t), tenor.rUsd(), tenor.rEur());
        uint256 diff = f > t.rate ? f - t.rate : t.rate - f;
        uint256 mag = (t.notionalUsd6 * diff) / t.rate;
        bool hedgerLong = t.side == Tenor.Side.SELL_USD; // sells USD => buys EUR forward
        bool up = f >= t.rate;
        bool pos = hedgerLong ? up : !up;
        return pos ? int256(mag) : -int256(mag);
    }

    // ----------------------------------- EIP-712 signing -----------------------------------

    function _digest(Tenor.Quote memory q) internal view returns (bytes32) {
        bytes32 typeHash = keccak256(
            "Quote(address dealer,uint8 side,uint256 notionalUsd6,uint256 rate,uint256 maturity,uint256 initialMarginBps,uint256 quoteExpiry,uint256 nonce,bool cashSettled)"
        );
        bytes32 structHash = keccak256(
            abi.encode(
                typeHash, q.dealer, q.side, q.notionalUsd6, q.rate, q.maturity,
                q.initialMarginBps, q.quoteExpiry, q.nonce, q.cashSettled
            )
        );
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Tenor"), keccak256("1"), block.chainid, address(tenor)
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }

    function _sign(uint256 pk, Tenor.Quote memory q) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, _digest(q));
        return abi.encodePacked(r, s, v);
    }

    function _pkOf(address d) internal view returns (uint256) {
        return d == dealer ? dealerPk : dealer2Pk;
    }

    /// Quote by `dealer` with rate = fair forward at the current spot.
    function _mkQuote(Tenor.Side side, uint256 notional, uint256 tenorSecs, bool cash)
        internal returns (Tenor.Quote memory q)
    {
        q = Tenor.Quote({
            dealer: dealer,
            side: uint8(side),
            notionalUsd6: notional,
            rate: _fair(_spotNow(), tenorSecs, tenor.rUsd(), tenor.rEur()),
            maturity: block.timestamp + tenorSecs,
            initialMarginBps: 500,
            quoteExpiry: block.timestamp + 1 hours,
            nonce: ++nonceCtr,
            cashSettled: cash
        });
    }

    // ----------------------------------- fixtures -----------------------------------

    function _fund(address user, uint256 amount) internal {
        usdc.mint(user, amount);
        vm.startPrank(user);
        usdc.approve(address(tenor), type(uint256).max);
        tenor.depositMargin(amount);
        vm.stopPrank();
    }

    /// Fund both parties with exactly the margin and open as `hedger` against q.dealer.
    function _openQuote(Tenor.Quote memory q) internal returns (uint256 id) {
        uint256 m = _ceilBps(q.notionalUsd6, q.initialMarginBps);
        _fund(hedger, m);
        _fund(q.dealer, m);
        bytes memory sig = _sign(_pkOf(q.dealer), q);
        vm.prank(hedger);
        id = tenor.open(q, sig);
    }

    function _openTrade(Tenor.Side side, bool cash) internal returns (uint256) {
        return _openQuote(_mkQuote(side, N, 30 days, cash));
    }

    function _setSpot(uint256 spot8) internal {
        vm.prank(owner);
        feed.setAnswer(int256(spot8));
    }

    /// Fund an EURC/USDC wallet leg and approve Tenor.
    function _wallet(address who, uint256 usdcAmt, uint256 eurcAmt) internal {
        usdc.mint(who, usdcAmt);
        eurc.mint(who, eurcAmt);
        vm.startPrank(who);
        usdc.approve(address(tenor), type(uint256).max);
        eurc.approve(address(tenor), type(uint256).max);
        vm.stopPrank();
    }

    function _eurAmount(uint256 notional, uint256 rate) internal pure returns (uint256) {
        return (notional * 1e18) / rate;
    }
}
