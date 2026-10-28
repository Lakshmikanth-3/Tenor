// Generated from contracts/out/MockAggregator.sol. Do not edit by hand.
export const feedAbi = [
 {"type":"constructor","inputs":[{"name":"owner_","type":"address","internalType":"address"},{"name":"initialAnswer","type":"int256","internalType":"int256"}],"stateMutability":"nonpayable"},
 {"type":"function","name":"decimals","inputs":[],"outputs":[{"name":"","type":"uint8","internalType":"uint8"}],"stateMutability":"view"},
 {"type":"function","name":"description","inputs":[],"outputs":[{"name":"","type":"string","internalType":"string"}],"stateMutability":"pure"},
 {"type":"function","name":"getRoundData","inputs":[{"name":"id","type":"uint80","internalType":"uint80"}],"outputs":[{"name":"","type":"uint80","internalType":"uint80"},{"name":"","type":"int256","internalType":"int256"},{"name":"","type":"uint256","internalType":"uint256"},{"name":"","type":"uint256","internalType":"uint256"},{"name":"","type":"uint80","internalType":"uint80"}],"stateMutability":"view"},
 {"type":"function","name":"latestRoundData","inputs":[],"outputs":[{"name":"","type":"uint80","internalType":"uint80"},{"name":"","type":"int256","internalType":"int256"},{"name":"","type":"uint256","internalType":"uint256"},{"name":"","type":"uint256","internalType":"uint256"},{"name":"","type":"uint80","internalType":"uint80"}],"stateMutability":"view"},
 {"type":"function","name":"owner","inputs":[],"outputs":[{"name":"","type":"address","internalType":"address"}],"stateMutability":"view"},
 {"type":"function","name":"renounceOwnership","inputs":[],"outputs":[],"stateMutability":"nonpayable"},
 {"type":"function","name":"roundId","inputs":[],"outputs":[{"name":"","type":"uint80","internalType":"uint80"}],"stateMutability":"view"},
 {"type":"function","name":"setAnswer","inputs":[{"name":"answer","type":"int256","internalType":"int256"}],"outputs":[],"stateMutability":"nonpayable"},
 {"type":"function","name":"setAnswerAt","inputs":[{"name":"answer","type":"int256","internalType":"int256"},{"name":"updatedAt","type":"uint256","internalType":"uint256"}],"outputs":[],"stateMutability":"nonpayable"},
 {"type":"function","name":"transferOwnership","inputs":[{"name":"newOwner","type":"address","internalType":"address"}],"outputs":[],"stateMutability":"nonpayable"},
 {"type":"function","name":"version","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},
 {"type":"event","name":"AnswerUpdated","inputs":[{"name":"answer","type":"int256","indexed":false,"internalType":"int256"},{"name":"roundId","type":"uint80","indexed":true,"internalType":"uint80"},{"name":"updatedAt","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},
 {"type":"event","name":"OwnershipTransferred","inputs":[{"name":"previousOwner","type":"address","indexed":true,"internalType":"address"},{"name":"newOwner","type":"address","indexed":true,"internalType":"address"}],"anonymous":false},
 {"type":"error","name":"NoDataPresent","inputs":[]},
 {"type":"error","name":"OwnableInvalidOwner","inputs":[{"name":"owner","type":"address","internalType":"address"}]},
 {"type":"error","name":"OwnableUnauthorizedAccount","inputs":[{"name":"account","type":"address","internalType":"address"}]}
] as const
