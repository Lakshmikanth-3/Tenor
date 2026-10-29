// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";
import {IYieldVault} from "./interfaces/IYieldVault.sol";

/**
 * @title Tenor
 * @notice Deliverable USDC/EURC forwards with segregated, bilateral USDC margin.
 * @dev Trust assumptions: the owner supplies annual rUsd/rEur (a v1 trust assumption)
 * and the oracle, and controls admission/configuration, but has no custody escape hatch.
 * Quotes are first-come, not bound to a hedger. Cash settlement observes the price at
 * call time, not a historical maturity fixing. Physical delivery unwinds all moved VM.
 * USDC and EURC must be distinct, standard six-decimal, non-rebasing, non-fee tokens.
 * Settlement credits pull balances; token blocklisting cannot veto another user's payout.
 * Yield mode is opt-in; the owner-set vault is a trusted dependency for free margin only.
 * Locked trade margins and USD legs always remain plain USDC, never vault shares.
 * Solvency: USDC held by Tenor == plain balances + locked margins + USD legs;
 * convertToAssets(totalVaultShares) >= the sum of each account's vault value.
 * Oracle/rate updates affect existing trades' valuation; maintenance, cure window and
 * delivery grace are snapshotted. New margin, admission and notional rules apply at open.
 *
 * Rounding: margins round up; EUR principal, fair forwards and bands round down. MTM is
 * notional * (forward-rate) / rate for SELL_USD, negated for BUY_USD, reflecting the fixed
 * EUR principal. Magnitude rounds down (against its receiver), without double rounding.
 * This intentionally supersedes the originally requested notional * (1 - rate/forward).
 * At maturity forward equals spot, valuing the agreed-versus-spot fixed-principal difference.
 * No rounding mints balances: every credit has a matching debit or inbound token transfer.
 * Unrepresentable positive feed values are BadPrice. Extreme theoretical MTM magnitudes
 * saturate at MAX_MTM, far beyond token supply; collateral movements remain fully capped.
 */
contract Tenor is Ownable2Step, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    address public constant USDC = 0x3600000000000000000000000000000000000000;
    address public immutable EURC;
    uint256 private constant WAD = 1e18;
    uint256 private constant BPS = 10_000;
    uint256 private constant YEAR = 365 days;
    uint256 private constant MAX_TENOR = 366 days;
    uint256 private constant MAX_MTM = uint256(type(int256).max) / 4;

    bytes32 public constant QUOTE_TYPEHASH = keccak256(
        "Quote(address dealer,uint8 side,uint256 notionalUsd6,uint256 rate,uint256 maturity,uint256 initialMarginBps,uint256 quoteExpiry,uint256 nonce,bool cashSettled)"
    );

    enum Side { SELL_USD, BUY_USD }
    enum Status { None, Open, Delivered, CashSettled, DeliveryFailed, ClosedOut }

    struct Quote {
        address dealer;
        uint8 side;
        uint256 notionalUsd6;
        uint256 rate;
        uint256 maturity;
        uint256 initialMarginBps;
        uint256 quoteExpiry;
        uint256 nonce;
        bool cashSettled;
    }

    struct Trade {
        address hedger;
        address dealer;
        Side side;
        Status status;
        bool cashSettled;
        uint256 notionalUsd6;
        uint256 rate;
        uint256 eurAmount6;
        uint256 maturity;
        uint256 openedAt;
        uint256 lastMarkAt;
        uint256 initialMarginUsd6;
        uint256 maintenanceBps;
        uint256 cureWindow;
        uint256 deliveryGrace;
        uint256 hedgerMargin;
        uint256 dealerMargin;
        int256 lastMtmHedger;
        uint8 callParty;
        uint256 callDeadline;
        bool usdLegFunded;
        bool eurLegFunded;
        uint256 usdLegAmount;
        uint256 eurLegAmount;
        uint256 hedgerShortfall;
        uint256 dealerShortfall;
    }

    /// @notice All risk fields are validated atomically, including the maintenance/initial relation.
    struct RiskParams {
        uint256 initialMarginBps;
        uint256 maintenanceBps;
        uint256 bandBps;
        uint256 markInterval;
        uint256 cureWindow;
        uint256 deliveryGrace;
        uint256 minTenor;
        uint256 maxNotionalUsd6;
        uint256 maxStaleness;
    }

    IAggregatorV3 public feed;
    uint256 public rUsd;
    uint256 public rEur;
    uint256 public initialMarginBps = 500;
    uint256 public maintenanceBps = 300;
    uint256 public bandBps = 50;
    uint256 public markInterval = 60;
    uint256 public cureWindow = 300;
    uint256 public deliveryGrace = 900;
    uint256 public minTenor = 300;
    uint256 public maxNotionalUsd6 = 50e6;
    uint256 public maxStaleness = 90_000;
    uint256 public nextTradeId = 1;

    mapping(address => bool) public dealers;
    mapping(address => mapping(uint256 => bool)) public nonceUsed;
    mapping(address => uint256) public usdcBalance;
    mapping(address => uint256) public eurcBalance;
    mapping(uint256 => Trade) private _trades;
    mapping(address => uint256[]) private _tradesByParty;

    /// @notice Trusted optional vault for free USDC; existing storage slots stay unchanged.
    IYieldVault public yieldVault;
    bool public yieldDepositsPaused;
    mapping(address => bool) public yieldMode;
    /// @notice Vault shares held by Tenor on behalf of each account.
    mapping(address => uint256) public vaultShares;
    /// @notice USDC cost basis of each account's remaining vault shares.
    mapping(address => uint256) public yieldPrincipal;
    /// @notice Cumulative positive realised yield in USDC.
    mapping(address => uint256) public yieldRealized;
    uint256 public totalVaultShares;

    error StalePrice();
    error BadPrice();
    error OffMarketRate();
    error QuoteExpired();
    error NonceUsed();
    error BadSignature();
    error DealerNotAllowed();
    error TenorTooShort();
    error NotionalTooLarge();
    error InsufficientMargin();
    error MarkTooSoon();
    error MarginLocked();
    error NoMarginCall();
    error CureWindowOpen();
    error NotMatured();
    error AlreadySettled();
    error LegAlreadyFunded();
    error LegUnfunded();
    error NotParty();
    error TradeClosed();
    error ZeroAddress();
    error ZeroAmount();
    error SelfTrade();
    error TenorTooLong();
    error ParamOutOfBounds();
    error NotPhysical();
    error TradeNotFound();
    error YieldUnavailable();
    error YieldVaultInUse();
    error VaultMismatch();
    error VaultRedeemFailed();
    error VaultDepositFailed();

    event YieldVaultSet(address indexed vault);
    event YieldDepositsPausedSet(bool paused);
    event YieldModeSet(address indexed user, bool on);
    event YieldDeposited(address indexed user, uint256 assets, uint256 shares);
    event YieldRedeemed(address indexed user, uint256 shares, uint256 assets);

    event MarginDeposited(address indexed user, uint256 amount);
    event MarginWithdrawn(address indexed user, uint256 amount);
    event EurcWithdrawn(address indexed user, uint256 amount);
    event TradeOpened(
        uint256 indexed tradeId, address indexed hedger, address indexed dealer, Side side,
        uint256 notionalUsd6, uint256 rate, uint256 maturity, bool cashSettled,
        uint256 initialMarginUsd6
    );
    event Marked(uint256 indexed tradeId, uint256 spot, uint256 forwardNow, int256 mtm, int256 vmMoved);
    event MarginCalled(uint256 indexed tradeId, address indexed party, uint256 deadline);
    event MarginCured(uint256 indexed tradeId, address indexed party);
    /// @dev paidToNonDefaulter is additional USDC VM moved at termination, not its entire refund.
    event ClosedOut(
        uint256 indexed tradeId, address indexed defaulter,
        uint256 paidToNonDefaulter, uint256 leftoverToDefaulter
    );
    event ShortfallRecorded(uint256 indexed tradeId, address indexed defaulter, uint256 amount);
    event LegFunded(uint256 indexed tradeId, address indexed funder, address token, uint256 amount);
    event Delivered(uint256 indexed tradeId);
    event DeliveryFailed(
        uint256 indexed tradeId, address indexed defaulter,
        uint256 paidToNonDefaulter, uint256 leftoverToDefaulter
    );
    event CashSettled(uint256 indexed tradeId, int256 finalMtm, uint256 paidToWinner);
    event NonceCancelled(address indexed dealer, uint256 indexed nonce);
    event FeedSet(address indexed feed);
    event RatesSet(uint256 rUsd, uint256 rEur);
    event DealerSet(address indexed dealer, bool allowed);
    event RiskParamsSet(RiskParams params);

    constructor(
        address initialOwner, address eurc, address priceFeed,
        uint256 rUsd_, uint256 rEur_, address[] memory dealers_, address yieldVault_
    ) Ownable(initialOwner) EIP712("Tenor", "1") {
        if (initialOwner == address(0) || eurc == address(0) || priceFeed == address(0)) {
            revert ZeroAddress();
        }
        if (eurc == USDC) revert ParamOutOfBounds();
        EURC = eurc;
        _setFeed(priceFeed);
        _setRates(rUsd_, rEur_);
        for (uint256 i; i < dealers_.length; ++i) {
            _setDealer(dealers_[i], true);
        }
        emit RiskParamsSet(_riskParams());
        _setYieldVault(yieldVault_);
    }

    // ------------------------------- Configuration -------------------------------

    /// @notice Changes the current oracle; it must expose eight decimal places.
    function setFeed(address priceFeed) external onlyOwner {
        _setFeed(priceFeed);
    }

    function setRates(uint256 rUsd_, uint256 rEur_) external onlyOwner {
        _setRates(rUsd_, rEur_);
    }

    function setDealer(address dealer, bool allowed) external onlyOwner {
        _setDealer(dealer, allowed);
    }

    /// @notice Sets all risk limits together; never modifies any trade or user balance.
    function setRiskParams(RiskParams calldata p) external onlyOwner {
        if (
            p.initialMarginBps < 100 || p.initialMarginBps > 5_000 ||
            p.maintenanceBps < 50 || p.maintenanceBps >= p.initialMarginBps ||
            p.bandBps < 1 || p.bandBps > 500 ||
            p.markInterval < 10 || p.markInterval > 1 days ||
            p.cureWindow < 30 || p.cureWindow > 7 days ||
            p.deliveryGrace < 30 || p.deliveryGrace > 7 days ||
            p.minTenor < 60 || p.minTenor > 365 days ||
            p.maxNotionalUsd6 == 0 || p.maxNotionalUsd6 > 10_000_000e6 ||
            p.maxStaleness < 60 || p.maxStaleness > 7 days
        ) revert ParamOutOfBounds();
        initialMarginBps = p.initialMarginBps;
        maintenanceBps = p.maintenanceBps;
        bandBps = p.bandBps;
        markInterval = p.markInterval;
        cureWindow = p.cureWindow;
        deliveryGrace = p.deliveryGrace;
        minTenor = p.minTenor;
        maxNotionalUsd6 = p.maxNotionalUsd6;
        maxStaleness = p.maxStaleness;
        emit RiskParamsSet(p);
    }

    function _setFeed(address priceFeed) private {
        if (priceFeed == address(0)) revert ZeroAddress();
        try IAggregatorV3(priceFeed).decimals() returns (uint8 dp) {
            if (dp != 8) revert ParamOutOfBounds();
        } catch {
            revert ParamOutOfBounds();
        }
        feed = IAggregatorV3(priceFeed);
        emit FeedSet(priceFeed);
    }

    function _setRates(uint256 usd, uint256 eur) private {
        if (usd > 0.5e18 || eur > 0.5e18) revert ParamOutOfBounds();
        rUsd = usd;
        rEur = eur;
        emit RatesSet(usd, eur);
    }

    function _setDealer(address dealer, bool allowed) private {
        if (dealer == address(0)) revert ZeroAddress();
        dealers[dealer] = allowed;
        emit DealerSet(dealer, allowed);
    }

    function _riskParams() private view returns (RiskParams memory p) {
        p = RiskParams(
            initialMarginBps, maintenanceBps, bandBps, markInterval, cureWindow,
            deliveryGrace, minTenor, maxNotionalUsd6, maxStaleness
        );
    }

    // -------------------------------- Yield margin --------------------------------

    /// @notice Sets the trusted vault, or disables it with zero; no outstanding shares may exist.
    function setYieldVault(address v) external onlyOwner nonReentrant {
        _setYieldVault(v);
    }

    /// @notice Stops new yield deposits without restricting any redemption.
    function setYieldDepositsPaused(bool paused) external onlyOwner nonReentrant {
        yieldDepositsPaused = paused;
        emit YieldDepositsPausedSet(paused);
    }

    function _setYieldVault(address v) private {
        if (totalVaultShares != 0) revert YieldVaultInUse();
        if (v != address(0)) {
            try IYieldVault(v).asset() returns (address underlying) {
                if (underlying != USDC) revert ParamOutOfBounds();
            } catch {
                revert ParamOutOfBounds();
            }
        }
        yieldVault = IYieldVault(v);
        emit YieldVaultSet(v);
    }

    /// @notice Opts free margin into yield, or attempts to redeem all shares when opting out.
    /// @dev Vault failure leaves funds in their prior form; opting out still clears the flag.
    function setYieldMode(bool on) external nonReentrant {
        if (on && !_vaultOpen()) revert YieldUnavailable();
        yieldMode[msg.sender] = on;
        emit YieldModeSet(msg.sender, on);
        if (on) {
            uint256 amount = usdcBalance[msg.sender];
            if (amount != 0 && _toVault(msg.sender, amount)) usdcBalance[msg.sender] -= amount;
        } else if (vaultShares[msg.sender] != 0) {
            _redeem(msg.sender, vaultShares[msg.sender], false);
        }
    }

    /// @notice Moves all of the caller's plain free USDC into the vault.
    /// @dev Settlement proceeds stay plain until swept so settlement never depends on the vault.
    function sweepToYield() external nonReentrant {
        if (!yieldMode[msg.sender] || !_vaultOpen()) revert YieldUnavailable();
        uint256 amount = usdcBalance[msg.sender];
        if (amount == 0) revert ZeroAmount();
        if (!_toVault(msg.sender, amount)) revert VaultDepositFailed();
        usdcBalance[msg.sender] -= amount;
    }

    /// @notice Whether new vault deposits are currently available.
    function yieldActive() external view returns (bool) {
        return _vaultOpen();
    }

    /// @notice Current vault value, falling back to principal if the vault cannot quote.
    function vaultValueOf(address user) public view returns (uint256) {
        uint256 shares = vaultShares[user];
        if (address(yieldVault) == address(0) || shares == 0) return 0;
        try yieldVault.convertToAssets(shares) returns (uint256 assets) {
            return assets;
        } catch {
            return yieldPrincipal[user];
        }
    }

    /// @notice Plain free USDC plus the current value of the account's vault shares.
    function freeMarginOf(address user) external view returns (uint256) {
        return usdcBalance[user] + vaultValueOf(user);
    }

    /// @notice Cumulative realised yield plus positive unrealised yield on remaining shares.
    function yieldEarned(address user) external view returns (uint256) {
        uint256 value = vaultValueOf(user);
        uint256 principal = yieldPrincipal[user];
        return yieldRealized[user] + (value > principal ? value - principal : 0);
    }

    function _vaultOpen() private view returns (bool) {
        return address(yieldVault) != address(0) && !yieldDepositsPaused;
    }

    function _toVault(address user, uint256 amount) private returns (bool ok) {
        // A deposit that would mint no shares stays plain rather than donating dust to the vault.
        try yieldVault.convertToShares(amount) returns (uint256 expected) {
            if (expected == 0) return false;
        } catch {
            return false;
        }
        IERC20 token = IERC20(USDC);
        address vault = address(yieldVault);
        token.forceApprove(vault, amount);
        uint256 beforeBalance = token.balanceOf(address(this));
        try yieldVault.deposit(amount, address(this)) returns (uint256 shares) {
            uint256 afterBalance = token.balanceOf(address(this));
            token.forceApprove(vault, 0);
            if (afterBalance > beforeBalance) revert VaultMismatch();
            uint256 spent = beforeBalance - afterBalance;
            if (spent != amount || shares == 0) revert VaultMismatch();
            vaultShares[user] += shares;
            yieldPrincipal[user] += amount;
            totalVaultShares += shares;
            emit YieldDeposited(user, amount, shares);
            return true;
        } catch {
            token.forceApprove(vault, 0);
            return false;
        }
    }

    function _redeem(address user, uint256 shares, bool strict) private returns (uint256 received) {
        uint256 allShares = vaultShares[user];
        shares = Math.min(shares, allShares);
        if (shares == 0) return 0;
        uint256 beforeBalance = IERC20(USDC).balanceOf(address(this));
        try yieldVault.redeem(shares, address(this), address(this)) returns (uint256) {
            received = IERC20(USDC).balanceOf(address(this)) - beforeBalance;
        } catch {
            if (strict) revert VaultRedeemFailed();
            return 0;
        }
        uint256 principal = yieldPrincipal[user];
        uint256 principalRemoved = shares == allShares ? principal : Math.mulDiv(principal, shares, allShares);
        vaultShares[user] = allShares - shares;
        yieldPrincipal[user] = principal - principalRemoved;
        totalVaultShares -= shares;
        if (received > principalRemoved) yieldRealized[user] += received - principalRemoved;
        usdcBalance[user] += received;
        emit YieldRedeemed(user, shares, received);
    }

    function _redeemAssets(address user, uint256 needed) private {
        if (vaultShares[user] == 0) revert InsufficientMargin();
        uint256 shares = yieldVault.convertToShares(needed);
        if (yieldVault.convertToAssets(shares) < needed) shares += 1;
        _redeem(user, shares, true);
    }

    function _ensurePlain(address user, uint256 amount) private {
        if (usdcBalance[user] >= amount) return;
        if (vaultShares[user] == 0) revert InsufficientMargin();
        _redeemAssets(user, amount - usdcBalance[user]);
        if (usdcBalance[user] < amount) revert InsufficientMargin();
    }

    // -------------------------------- Pull balances --------------------------------

    function depositMargin(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        IERC20(USDC).safeTransferFrom(msg.sender, address(this), amount);
        if (!(yieldMode[msg.sender] && _vaultOpen() && _toVault(msg.sender, amount))) {
            usdcBalance[msg.sender] += amount;
        }
        emit MarginDeposited(msg.sender, amount);
    }

    function withdrawMargin(uint256 amount) external nonReentrant {
        if (usdcBalance[msg.sender] < amount) {
            _redeemAssets(msg.sender, amount - usdcBalance[msg.sender]);
        }
        _withdrawMargin(amount);
    }

    /// @notice Attempts to redeem all shares, then withdraws all plain free USDC; zero is a no-op.
    /// @dev A failed vault redemption never blocks withdrawal of the plain balance.
    function withdraw() external nonReentrant {
        if (vaultShares[msg.sender] != 0) _redeem(msg.sender, vaultShares[msg.sender], false);
        _withdrawMargin(usdcBalance[msg.sender]);
    }

    function withdrawEurc() external nonReentrant {
        uint256 amount = eurcBalance[msg.sender];
        eurcBalance[msg.sender] = 0;
        if (amount != 0) IERC20(EURC).safeTransfer(msg.sender, amount);
        emit EurcWithdrawn(msg.sender, amount);
    }

    function _withdrawMargin(uint256 amount) private {
        if (usdcBalance[msg.sender] < amount) revert InsufficientMargin();
        usdcBalance[msg.sender] -= amount;
        if (amount != 0) IERC20(USDC).safeTransfer(msg.sender, amount);
        emit MarginWithdrawn(msg.sender, amount);
    }

    function marginOf(address user) external view returns (uint256) {
        return usdcBalance[user];
    }

    function eurcBalanceOf(address user) external view returns (uint256) {
        return eurcBalance[user];
    }

    // ----------------------------------- Pricing -----------------------------------

    function quote(uint256 notionalUsd6, uint256 tenorSeconds)
        external view
        returns (uint256 spot, uint256 forwardFair, uint256 bandLow,
            uint256 bandHigh, uint256 initialMarginUsd6)
    {
        if (tenorSeconds > MAX_TENOR) revert TenorTooLong();
        if (notionalUsd6 == 0) revert ZeroAmount();
        if (notionalUsd6 > maxNotionalUsd6) revert NotionalTooLarge();
        spot = _spot();
        forwardFair = _forward(spot, tenorSeconds);
        uint256 band = Math.mulDiv(forwardFair, bandBps, BPS);
        bandLow = forwardFair - band;
        bandHigh = forwardFair + band;
        initialMarginUsd6 = _margin(notionalUsd6, initialMarginBps);
    }

    function forwardNow(uint256 tradeId) public view returns (uint256) {
        Trade storage t = _existing(tradeId);
        return _forward(_spot(), _remaining(t));
    }

    /// @notice Current theoretical hedger MTM. Also provides a catchable oracle/math boundary.
    function currentMtm(uint256 tradeId) external view returns (int256) {
        Trade storage t = _existing(tradeId);
        return _mtm(t, _forward(_spot(), _remaining(t)));
    }

    function _spot() private view returns (uint256) {
        try feed.latestRoundData() returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80) {
            if (answer <= 0 || updatedAt == 0 || updatedAt > block.timestamp) revert BadPrice();
            if (block.timestamp - updatedAt > maxStaleness) revert StalePrice();
            // The headroom also protects fair-value and band calculations at maximum tenor.
            if (uint256(answer) > type(uint256).max / 4 / 1e10) revert BadPrice();
            return uint256(answer) * 1e10;
        } catch {
            revert BadPrice();
        }
    }

    function _forward(uint256 spot, uint256 tenor) private view returns (uint256) {
        return Math.mulDiv(spot, WAD + rUsd * tenor / YEAR, WAD + rEur * tenor / YEAR);
    }

    function _remaining(Trade storage t) private view returns (uint256) {
        return t.maturity > block.timestamp ? t.maturity - block.timestamp : 0;
    }

    /// @dev SELL_USD MTM is notional*(fair-rate)/rate; BUY_USD negates it.
    /// Magnitude rounds down against its receiver, then the hedger-side sign is applied.
    function _mtm(Trade storage t, uint256 fair) private view returns (int256) {
        uint256 difference = fair >= t.rate ? fair - t.rate : t.rate - fair;
        uint256 magnitude;
        // Compare the 512-bit products difference*notional and MAX_MTM*rate without overflow.
        if (Math.mulDiv(difference, t.notionalUsd6, MAX_MTM, Math.Rounding.Ceil) > t.rate) {
            magnitude = MAX_MTM;
        } else {
            magnitude = Math.mulDiv(difference, t.notionalUsd6, t.rate);
        }
        bool positive = fair >= t.rate;
        if (t.side == Side.BUY_USD) positive = !positive;
        return positive ? int256(magnitude) : -int256(magnitude);
    }

    function _margin(uint256 notional, uint256 bps) private pure returns (uint256) {
        return Math.mulDiv(notional, bps, BPS, Math.Rounding.Ceil);
    }

    // -------------------------------- Quote admission --------------------------------

    /// @notice Full EIP-712 digest, including domain separator, suitable for ECDSA signing.
    function hashQuote(Quote calldata q) public view returns (bytes32) {
        // Quote is entirely static, so ABI encoding the tuple is identical to encoding its fields.
        return _hashTypedDataV4(keccak256(abi.encode(QUOTE_TYPEHASH, q)));
    }

    function cancelNonce(uint256 nonce) external {
        nonceUsed[msg.sender][nonce] = true;
        emit NonceCancelled(msg.sender, nonce);
    }

    function open(Quote calldata q, bytes calldata sig) external nonReentrant returns (uint256 id) {
        _validateQuote(q, sig);
        if (q.initialMarginBps < initialMarginBps || q.initialMarginBps > BPS) {
            revert InsufficientMargin();
        }
        uint256 margin = _margin(q.notionalUsd6, q.initialMarginBps);
        _ensurePlain(msg.sender, margin);
        _ensurePlain(q.dealer, margin);
        if (msg.sender == q.dealer) revert SelfTrade();
        usdcBalance[msg.sender] -= margin;
        usdcBalance[q.dealer] -= margin;
        id = nextTradeId++;
        _initializeTrade(id, q, margin);
        _tradesByParty[msg.sender].push(id);
        _tradesByParty[q.dealer].push(id);
        _emitOpened(id);
    }

    function _validateQuote(Quote calldata q, bytes calldata sig) private {
        if (block.timestamp > q.quoteExpiry) revert QuoteExpired();
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(hashQuote(q), sig);
        if (err != ECDSA.RecoverError.NoError || signer != q.dealer || q.side > 1) {
            revert BadSignature();
        }
        if (!dealers[q.dealer]) revert DealerNotAllowed();
        if (nonceUsed[q.dealer][q.nonce]) revert NonceUsed();
        nonceUsed[q.dealer][q.nonce] = true;
        if (q.maturity < block.timestamp + minTenor) revert TenorTooShort();
        uint256 tenor = q.maturity - block.timestamp;
        if (tenor > MAX_TENOR) revert TenorTooLong();
        if (q.notionalUsd6 == 0) revert ZeroAmount();
        if (q.notionalUsd6 > maxNotionalUsd6) revert NotionalTooLarge();
        uint256 fair = _forward(_spot(), tenor);
        uint256 distance = q.rate >= fair ? q.rate - fair : fair - q.rate;
        if (distance > Math.mulDiv(fair, bandBps, BPS)) revert OffMarketRate();
    }

    function _initializeTrade(uint256 id, Quote calldata q, uint256 margin) private {
        Trade storage t = _trades[id];
        t.hedger = msg.sender;
        t.dealer = q.dealer;
        t.side = Side(q.side);
        t.status = Status.Open;
        t.cashSettled = q.cashSettled;
        t.notionalUsd6 = q.notionalUsd6;
        t.rate = q.rate;
        t.eurAmount6 = Math.mulDiv(q.notionalUsd6, WAD, q.rate);
        t.maturity = q.maturity;
        t.openedAt = block.timestamp;
        t.lastMarkAt = block.timestamp;
        t.initialMarginUsd6 = margin;
        t.maintenanceBps = maintenanceBps;
        t.cureWindow = cureWindow;
        t.deliveryGrace = deliveryGrace;
        t.hedgerMargin = margin;
        t.dealerMargin = margin;
    }

    function _emitOpened(uint256 id) private {
        Trade storage t = _trades[id];
        emit TradeOpened(id, t.hedger, t.dealer, t.side, t.notionalUsd6,
            t.rate, t.maturity, t.cashSettled, t.initialMarginUsd6);
    }

    // -------------------------------- Variation margin --------------------------------

    function mark(uint256 tradeId) external nonReentrant {
        Trade storage t = _openTrade(tradeId);
        if (block.timestamp - t.lastMarkAt < markInterval) revert MarkTooSoon();
        uint256 spot = _spot();
        uint256 fair = _forward(spot, _remaining(t));
        int256 mtm = _mtm(t, fair);
        int256 moved = _moveTo(t, mtm);
        t.lastMarkAt = block.timestamp;
        emit Marked(tradeId, spot, fair, mtm, moved);
        _updateCall(tradeId, t);
    }

    /// @dev Transfers only within this trade; lastMtm tracks actual, not theoretical, movement.
    function _moveTo(Trade storage t, int256 target) private returns (int256 moved) {
        int256 delta = target - t.lastMtmHedger;
        if (delta > 0) {
            uint256 amount = Math.min(uint256(delta), t.dealerMargin);
            t.dealerMargin -= amount;
            t.hedgerMargin += amount;
            moved = int256(amount);
        } else if (delta < 0) {
            uint256 amount = Math.min(uint256(-delta), t.hedgerMargin);
            t.hedgerMargin -= amount;
            t.dealerMargin += amount;
            moved = -int256(amount);
        }
        t.lastMtmHedger += moved;
    }

    function _updateCall(uint256 id, Trade storage t) private {
        if (t.callParty != 0) {
            _tryCure(id, t);
            return;
        }
        uint256 maintenance = _margin(t.notionalUsd6, t.maintenanceBps);
        if (t.hedgerMargin < maintenance) t.callParty = 1;
        else if (t.dealerMargin < maintenance) t.callParty = 2;
        else return;
        t.callDeadline = block.timestamp + t.cureWindow;
        emit MarginCalled(id, _partyAddress(t, t.callParty), t.callDeadline);
    }

    function _tryCure(uint256 id, Trade storage t) private {
        uint8 called = t.callParty;
        if (called == 0) return;
        uint256 balance = called == 1 ? t.hedgerMargin : t.dealerMargin;
        if (balance >= t.initialMarginUsd6) {
            t.callParty = 0;
            t.callDeadline = 0;
            emit MarginCured(id, _partyAddress(t, called));
        }
    }

    function topUp(uint256 tradeId, uint256 amount) external nonReentrant {
        Trade storage t = _openTrade(tradeId);
        uint8 party = _party(t);
        if (amount == 0) revert ZeroAmount();
        _ensurePlain(msg.sender, amount);
        usdcBalance[msg.sender] -= amount;
        if (party == 1) t.hedgerMargin += amount;
        else t.dealerMargin += amount;
        if (t.callParty == party) _tryCure(tradeId, t);
    }

    function withdrawExcess(uint256 tradeId, uint256 amount) external nonReentrant {
        Trade storage t = _openTrade(tradeId);
        uint8 party = _party(t);
        if (t.callParty != 0) revert MarginLocked();
        uint256 locked = t.initialMarginUsd6;
        int256 received = party == 1 ? t.lastMtmHedger : -t.lastMtmHedger;
        if (!t.cashSettled && received > 0) locked += uint256(received);
        uint256 balance = party == 1 ? t.hedgerMargin : t.dealerMargin;
        uint256 excess = balance > locked ? balance - locked : 0;
        if (amount > excess) revert InsufficientMargin();
        if (party == 1) t.hedgerMargin -= amount;
        else t.dealerMargin -= amount;
        usdcBalance[msg.sender] += amount;
    }

    // ------------------------------------ Close out ------------------------------------

    /// @notice Current mark inputs, exposed as a catchable oracle/math boundary.
    function currentMark(uint256 tradeId) external view returns (uint256 spot, uint256 fair, int256 mtm) {
        Trade storage t = _existing(tradeId);
        spot = _spot();
        fair = _forward(spot, _remaining(t));
        mtm = _mtm(t, fair);
    }

    function closeOut(uint256 tradeId) external nonReentrant {
        Trade storage t = _openTrade(tradeId);
        if (t.callParty == 0) revert NoMarginCall();
        if (block.timestamp <= t.callDeadline) revert CureWindowOpen();
        uint8 defaulter = t.callParty;
        int256 previousMtm = t.lastMtmHedger;
        int256 mtm = previousMtm;
        try this.currentMark(tradeId) returns (uint256 spot, uint256 fair, int256 freshMtm) {
            mtm = freshMtm;
            int256 moved = _moveTo(t, mtm);
            t.lastMarkAt = block.timestamp;
            emit Marked(tradeId, spot, fair, mtm, moved);
            _tryCure(tradeId, t);
            if (t.callParty == 0) return;
        } catch {
            // Oracle unavailable: retain the last-mark fallback without sweeping VM.
        }
        (, uint256 leftover) = _defaultSettlement(tradeId, t, defaulter, mtm);
        // Include the fresh sweep in additional VM paid at termination, not the refund.
        int256 netMoved = t.lastMtmHedger - previousMtm;
        if (defaulter == 1) netMoved = -netMoved;
        uint256 paid = netMoved > 0 ? uint256(netMoved) : 0;
        _refundLegs(t);
        _releaseMargins(t, false);
        t.status = Status.ClosedOut;
        _clearCall(t);
        emit ClosedOut(tradeId, _partyAddress(t, defaulter), paid, leftover);
    }

    /// @dev Defaults reset the non-defaulter's entitlement to max(current MTM, 0).
    function _defaultSettlement(uint256 id, Trade storage t, uint8 defaulter)
        private returns (uint256 paid, uint256 leftover)
    {
        return _defaultSettlement(id, t, defaulter, _bestEffortMtm(id, t));
    }

    /// @dev Uses the same MTM as the close-out sweep; delivery defaults use the wrapper above.
    function _defaultSettlement(uint256 id, Trade storage t, uint8 defaulter, int256 mtm)
        private returns (uint256 paid, uint256 leftover)
    {
        bool ndIsHedger = defaulter == 2;
        int256 ndMtm = ndIsHedger ? mtm : -mtm;
        int256 ndLast = ndIsHedger ? t.lastMtmHedger : -t.lastMtmHedger;
        int256 target = ndMtm > 0 ? ndMtm : int256(0);
        int256 delta = target - ndLast;
        int256 moved = _moveTo(t, ndIsHedger ? target : -target);
        int256 ndMoved = ndIsHedger ? moved : -moved;
        if (ndMoved > 0) paid = uint256(ndMoved);
        if (delta > 0 && uint256(delta) > paid) {
            _recordShortfall(id, t, defaulter, uint256(delta) - paid);
        }
        leftover = defaulter == 1 ? t.hedgerMargin : t.dealerMargin;
    }

    function _bestEffortMtm(uint256 id, Trade storage t) private view returns (int256) {
        try this.currentMtm(id) returns (int256 mtm) {
            return mtm;
        } catch {
            return t.lastMtmHedger;
        }
    }

    function _recordShortfall(uint256 id, Trade storage t, uint8 defaulter, uint256 amount) private {
        if (defaulter == 1) t.hedgerShortfall += amount;
        else t.dealerShortfall += amount;
        emit ShortfallRecorded(id, _partyAddress(t, defaulter), amount);
    }

    // -------------------------------- Physical delivery --------------------------------

    /// @notice Funds the caller's full principal leg from its wallet, not its free balance.
    function fundLeg(uint256 tradeId) external nonReentrant {
        Trade storage t = _openTrade(tradeId);
        uint8 party = _party(t);
        if (t.cashSettled) revert NotPhysical();
        if (block.timestamp < t.maturity) revert NotMatured();
        bool usdSeller = (party == 1) == (t.side == Side.SELL_USD);
        address token;
        uint256 amount;
        if (usdSeller) {
            if (t.usdLegFunded) revert LegAlreadyFunded();
            t.usdLegFunded = true;
            t.usdLegAmount = t.notionalUsd6;
            token = USDC;
            amount = t.notionalUsd6;
        } else {
            if (t.eurLegFunded) revert LegAlreadyFunded();
            t.eurLegFunded = true;
            t.eurLegAmount = t.eurAmount6;
            token = EURC;
            amount = t.eurAmount6;
        }
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit LegFunded(tradeId, msg.sender, token, amount);
    }

    /// @notice Anyone may atomically settle; all proceeds remain internal pull balances.
    function settle(uint256 tradeId) external nonReentrant {
        Trade storage t = _openTrade(tradeId);
        if (block.timestamp < t.maturity) revert NotMatured();
        if (t.cashSettled) {
            _cashSettlement(tradeId, t);
        } else if (t.usdLegFunded && t.eurLegFunded) {
            _deliver(tradeId, t);
        } else {
            if (block.timestamp < t.maturity + t.deliveryGrace) revert LegUnfunded();
            _failedDelivery(tradeId, t);
        }
        _clearCall(t);
    }

    function _deliver(uint256 id, Trade storage t) private {
        (address usdSeller, address eurSeller) = _sellers(t);
        usdcBalance[eurSeller] += t.usdLegAmount;
        eurcBalance[usdSeller] += t.eurLegAmount;
        t.usdLegAmount = 0;
        t.eurLegAmount = 0;
        _releaseMargins(t, true);
        t.status = Status.Delivered;
        emit Delivered(id);
    }

    function _failedDelivery(uint256 id, Trade storage t) private {
        if (!t.usdLegFunded && !t.eurLegFunded) {
            // Mutual cancellation: neither party receives an oracle-dependent windfall.
            _releaseMargins(t, true);
            t.status = Status.DeliveryFailed;
            emit DeliveryFailed(id, address(0), 0, 0);
            return;
        }
        bool hedgerSellsUsd = t.side == Side.SELL_USD;
        bool hedgerFunded = t.usdLegFunded ? hedgerSellsUsd : !hedgerSellsUsd;
        uint8 defaulter = hedgerFunded ? 2 : 1;
        (uint256 paid, uint256 leftover) = _defaultSettlement(id, t, defaulter);
        _refundLegs(t);
        _releaseMargins(t, false);
        t.status = Status.DeliveryFailed;
        emit DeliveryFailed(id, _partyAddress(t, defaulter), paid, leftover);
    }

    function _cashSettlement(uint256 id, Trade storage t) private {
        int256 finalMtm;
        if (block.timestamp < t.maturity + t.deliveryGrace) {
            // Before the grace boundary a bad/stale feed must fail, rather than fix at old VM.
            finalMtm = _mtm(t, _forward(_spot(), 0));
        } else {
            finalMtm = _bestEffortMtm(id, t);
        }
        int256 delta = finalMtm - t.lastMtmHedger;
        int256 moved = _moveTo(t, finalMtm);
        uint256 paid = moved >= 0 ? uint256(moved) : uint256(-moved);
        uint256 owed = delta >= 0 ? uint256(delta) : uint256(-delta);
        if (owed > paid) _recordShortfall(id, t, delta > 0 ? 2 : 1, owed - paid);
        _releaseMargins(t, false);
        t.status = Status.CashSettled;
        emit CashSettled(id, finalMtm, paid);
    }

    function _refundLegs(Trade storage t) private {
        (address usdSeller, address eurSeller) = _sellers(t);
        if (t.usdLegAmount != 0) {
            usdcBalance[usdSeller] += t.usdLegAmount;
            t.usdLegAmount = 0;
        }
        if (t.eurLegAmount != 0) {
            eurcBalance[eurSeller] += t.eurLegAmount;
            t.eurLegAmount = 0;
        }
    }

    /// @dev Physical excess-withdrawal restrictions guarantee an unwind cannot underflow.
    function _releaseMargins(Trade storage t, bool unwind) private {
        uint256 hedger = t.hedgerMargin;
        uint256 dealer = t.dealerMargin;
        if (unwind) {
            int256 vm = t.lastMtmHedger;
            if (vm >= 0) {
                hedger -= uint256(vm);
                dealer += uint256(vm);
            } else {
                hedger += uint256(-vm);
                dealer -= uint256(-vm);
            }
        }
        usdcBalance[t.hedger] += hedger;
        usdcBalance[t.dealer] += dealer;
        t.hedgerMargin = 0;
        t.dealerMargin = 0;
    }

    function _clearCall(Trade storage t) private {
        t.callParty = 0;
        t.callDeadline = 0;
    }

    // ----------------------------------- Read helpers -----------------------------------

    function getTrade(uint256 id) external view returns (Trade memory) {
        return _existing(id);
    }

    function tradesOf(address user) external view returns (uint256[] memory) {
        return _tradesByParty[user];
    }

    /// @notice Oracle-independent collateral and cure-window state.
    function health(uint256 id) external view returns (
        uint256 hedgerMargin, uint256 dealerMargin, uint256 maintenanceUsd6,
        uint8 callParty, uint256 callDeadline, int256 lastMtmHedger
    ) {
        Trade storage t = _existing(id);
        return (t.hedgerMargin, t.dealerMargin, _margin(t.notionalUsd6, t.maintenanceBps),
            t.callParty, t.callDeadline, t.lastMtmHedger);
    }

    function _existing(uint256 id) private view returns (Trade storage t) {
        t = _trades[id];
        if (t.status == Status.None) revert TradeNotFound();
    }

    function _openTrade(uint256 id) private view returns (Trade storage t) {
        t = _existing(id);
        if (t.status == Status.ClosedOut) revert TradeClosed();
        if (t.status != Status.Open) revert AlreadySettled();
    }

    function _party(Trade storage t) private view returns (uint8) {
        if (msg.sender == t.hedger) return 1;
        if (msg.sender == t.dealer) return 2;
        revert NotParty();
    }

    function _partyAddress(Trade storage t, uint8 party) private view returns (address) {
        return party == 1 ? t.hedger : t.dealer;
    }

    function _sellers(Trade storage t) private view returns (address usdSeller, address eurSeller) {
        return t.side == Side.SELL_USD ? (t.hedger, t.dealer) : (t.dealer, t.hedger);
    }
}
