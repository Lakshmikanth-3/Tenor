// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";

/// @notice Owner-controlled eight-decimal EUR/USD feed for testing, including invalid prices.
contract MockAggregator is Ownable, IAggregatorV3 {
    struct Round {
        int256 answer;
        uint256 updatedAt;
    }

    error NoDataPresent();

    uint8 public constant override decimals = 8;
    uint256 public constant override version = 1;
    uint80 public roundId;
    mapping(uint80 => Round) private _rounds;

    event AnswerUpdated(int256 answer, uint80 indexed roundId, uint256 updatedAt);

    constructor(address owner_, int256 initialAnswer) Ownable(owner_) {
        _setAnswer(initialAnswer, block.timestamp);
    }

    function description() external pure override returns (string memory) {
        return "EUR / USD (mock)";
    }

    /// @notice Adds a round stamped with the current block timestamp.
    function setAnswer(int256 answer) external onlyOwner {
        _setAnswer(answer, block.timestamp);
    }

    /// @notice Adds a round with an arbitrary answer and timestamp, including invalid/stale data.
    function setAnswerAt(int256 answer, uint256 updatedAt) external onlyOwner {
        _setAnswer(answer, updatedAt);
    }

    function getRoundData(uint80 id)
        public
        view
        override
        returns (uint80, int256, uint256, uint256, uint80)
    {
        if (id == 0 || id > roundId) revert NoDataPresent();
        Round storage round = _rounds[id];
        return (id, round.answer, round.updatedAt, round.updatedAt, id);
    }

    function latestRoundData()
        external
        view
        override
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return getRoundData(roundId);
    }

    function _setAnswer(int256 answer, uint256 updatedAt) private {
        uint80 id = ++roundId;
        _rounds[id] = Round(answer, updatedAt);
        emit AnswerUpdated(answer, id, updatedAt);
    }
}
