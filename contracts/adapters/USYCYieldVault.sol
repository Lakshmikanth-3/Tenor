// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Subset of Circle's USYC Teller (ERC-4626 style) used by this adapter.
interface IUSYCTeller {
    function asset() external view returns (address);
    function share() external view returns (address);
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function redeem(uint256 shares, address receiver, address account) external returns (uint256 assets);
    function convertToShares(uint256 assets) external view returns (uint256);
    function previewRedeem(uint256 shares) external view returns (uint256);
}

/**
 * @title USYCYieldVault
 * @notice Adapter that lets Tenor hold free margin in Circle USYC through the Teller, behind the
 * IYieldVault interface Tenor v2 already uses (asset, deposit, redeem, convertToAssets, convertToShares).
 * @dev Vault shares are USYC units, 1:1. Only the single immutable depositor (the Tenor contract) can
 * deposit or redeem, so the permissioned USYC position is never reachable by anyone else, and there is
 * no owner or admin function that can move funds. USYC is permissioned: this adapter's address must be
 * allowlisted by Circle. Redemptions are paid to the adapter first and then forwarded as plain USDC,
 * so the depositor itself never needs to be allowlisted.
 */
contract USYCYieldVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IUSYCTeller public immutable teller;
    IERC20 public immutable usdc;
    IERC20 public immutable usyc;
    address public immutable depositor;

    /// @notice USYC units held for the depositor (equals this contract's USYC balance in normal use).
    uint256 public totalShares;

    error NotDepositor();
    error ZeroAmount();
    error BadReceiver();
    error InsufficientShares();
    error TellerMismatch();

    event Deposited(uint256 assets, uint256 shares);
    event Redeemed(uint256 shares, uint256 assets, address receiver);

    constructor(address teller_, address depositor_) {
        if (teller_ == address(0) || depositor_ == address(0)) revert BadReceiver();
        teller = IUSYCTeller(teller_);
        usdc = IERC20(IUSYCTeller(teller_).asset());
        usyc = IERC20(IUSYCTeller(teller_).share());
        depositor = depositor_;
    }

    modifier onlyDepositor() {
        if (msg.sender != depositor) revert NotDepositor();
        _;
    }

    /// @notice Underlying asset (USDC).
    function asset() external view returns (address) {
        return address(usdc);
    }

    /// @notice Subscribes `assets` USDC into USYC; shares minted equal USYC received.
    function deposit(uint256 assets, address receiver) external nonReentrant onlyDepositor returns (uint256 shares) {
        if (assets == 0) revert ZeroAmount();
        if (receiver != depositor) revert BadReceiver();
        usdc.safeTransferFrom(msg.sender, address(this), assets);
        uint256 usycBefore = usyc.balanceOf(address(this));
        usdc.forceApprove(address(teller), assets);
        teller.deposit(assets, address(this));
        usdc.forceApprove(address(teller), 0);
        shares = usyc.balanceOf(address(this)) - usycBefore;
        if (shares == 0) revert TellerMismatch();
        totalShares += shares;
        emit Deposited(assets, shares);
    }

    /// @notice Redeems `shares` USYC and forwards the USDC proceeds to `receiver`.
    function redeem(uint256 shares, address receiver, address owner)
        external
        nonReentrant
        onlyDepositor
        returns (uint256 assets)
    {
        if (shares == 0) revert ZeroAmount();
        if (owner != depositor || receiver == address(0)) revert BadReceiver();
        if (shares > totalShares) revert InsufficientShares();
        totalShares -= shares;
        uint256 usdcBefore = usdc.balanceOf(address(this));
        teller.redeem(shares, address(this), address(this));
        assets = usdc.balanceOf(address(this)) - usdcBefore;
        usdc.safeTransfer(receiver, assets);
        emit Redeemed(shares, assets, receiver);
    }

    /// @notice USDC a redemption of `shares` would pay now (Teller price, after any redemption fee).
    function convertToAssets(uint256 shares) external view returns (uint256) {
        return shares == 0 ? 0 : teller.previewRedeem(shares);
    }

    /// @notice USYC units equivalent to `assets` USDC at the Teller's oracle price.
    function convertToShares(uint256 assets) external view returns (uint256) {
        return assets == 0 ? 0 : teller.convertToShares(assets);
    }
}
