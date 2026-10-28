// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {MockBlocklistERC20} from "./MockBlocklistERC20.sol";

contract MockEURC is MockBlocklistERC20 {
    constructor() ERC20("Mock EURC", "mEURC") {}
}
