// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev 6-decimal ERC-20 with a blocklist: any transfer/transferFrom to or from a
/// blocklisted address reverts (mirrors Circle USDC/EURC behaviour). Mint is open for tests.
abstract contract MockBlocklistERC20 is ERC20 {
    error Blocklisted(address account);

    mapping(address => bool) public isBlocklisted;

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBlocklisted(address account, bool blocked) external {
        isBlocklisted[account] = blocked;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (isBlocklisted[from]) revert Blocklisted(from);
        if (isBlocklisted[to]) revert Blocklisted(to);
        super._update(from, to, value);
    }
}
