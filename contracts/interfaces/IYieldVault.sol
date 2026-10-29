// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IYieldVault
/// @notice ERC-4626 style subset used by Tenor for optional free-margin yield.
interface IYieldVault {
    /// @notice Returns the address of the underlying asset.
    function asset() external view returns (address);

    /// @notice Deposits assets and issues shares to receiver.
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);

    /// @notice Redeems owner's shares and transfers assets to receiver.
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets);

    /// @notice Quotes the asset value of shares, rounding down.
    function convertToAssets(uint256 shares) external view returns (uint256);

    /// @notice Quotes shares for assets, rounding down.
    function convertToShares(uint256 assets) external view returns (uint256);
}
