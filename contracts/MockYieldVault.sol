// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title MockYieldVault
 * @notice Testnet-only stand-in for Circle USYC with synthetic 4.5% annual price growth.
 * @dev This vault does not invest deposits: accrued yield must be separately funded before
 * it can be redeemed. Underfunded redemptions revert through standard ERC-4626 transfers.
 * A real adapter would wrap the USYC Teller to bridge its subscription/redemption flows,
 * permissions and liquidity constraints into the ERC-4626 interface expected by Tenor;
 * a synthetic price is not a substitute for the Teller's actual execution and accounting.
 * Conversions use the synthetic price directly (no virtual shares), so an empty vault never
 * resets the price and yield cannot be harvested by cycling deposits and full redemptions.
 */
contract MockYieldVault is ERC4626, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant APY_BPS = 450;
    uint256 private constant WAD = 1e18;
    uint256 private constant BPS = 10_000;
    uint256 private constant YEAR = 365 days;

    uint256 public storedPrice = WAD;
    uint256 public lastUpdate;

    error ParamOutOfBounds();

    event PriceBumped(uint256 bps, uint256 newPrice);

    /// @notice Creates a testnet vault for the supplied underlying asset.
    constructor(address owner_, IERC20 asset_)
        ERC20("Mock USYC (testnet)", "mUSYC") ERC4626(asset_) Ownable(owner_)
    {
        lastUpdate = block.timestamp;
    }

    /// @notice Returns the synthetic annual yield in basis points.
    function apyBps() external pure returns (uint256) {
        return APY_BPS;
    }

    /// @notice Synthetic WAD asset price per whole share, with simple interest since checkpoint.
    function price() public view returns (uint256) {
        return storedPrice + Math.mulDiv(storedPrice, APY_BPS * (block.timestamp - lastUpdate), YEAR * BPS);
    }

    /// @notice Synthetic accrued asset liability, not the vault's funded reserve balance.
    function totalAssets() public view override returns (uint256) {
        return Math.mulDiv(totalSupply(), price(), WAD);
    }

    /// @dev Direct price conversion; the inherited virtual-share formula would reset the price at zero supply.
    function _convertToShares(uint256 assets, Math.Rounding rounding) internal view override returns (uint256) {
        return Math.mulDiv(assets, WAD, price(), rounding);
    }

    /// @dev Direct price conversion, rounded as requested by the ERC-4626 caller.
    function _convertToAssets(uint256 shares, Math.Rounding rounding) internal view override returns (uint256) {
        return Math.mulDiv(shares, price(), WAD, rounding);
    }

    /// @notice Checkpoints accrued interest, then raises the stored price by 1..1000 bps.
    function bumpPrice(uint256 bps) external onlyOwner nonReentrant {
        if (bps == 0 || bps > 1_000) revert ParamOutOfBounds();
        storedPrice = price();
        lastUpdate = block.timestamp;
        storedPrice = Math.mulDiv(storedPrice, BPS + bps, BPS);
        emit PriceBumped(bps, storedPrice);
    }

    /// @notice Supplies actual underlying reserves without minting shares or changing the price.
    function fundYield(uint256 amount) external nonReentrant {
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Unfunded synthetic assets; zero when the reserve covers the accrued liability.
    function reserveShortfall() external view returns (uint256) {
        uint256 liability = totalAssets();
        uint256 reserve = IERC20(asset()).balanceOf(address(this));
        return liability > reserve ? liability - reserve : 0;
    }

    /// @dev Guards both inherited deposit and mint without altering ERC-4626 conversions.
    function _deposit(address caller, address receiver, uint256 assets, uint256 shares)
        internal override nonReentrant
    {
        super._deposit(caller, receiver, assets, shares);
    }

    /// @dev Guards both inherited withdraw and redeem; reserve failures revert atomically.
    function _withdraw(address caller, address receiver, address owner, uint256 assets, uint256 shares)
        internal override nonReentrant
    {
        super._withdraw(caller, receiver, owner, assets, shares);
    }
}
