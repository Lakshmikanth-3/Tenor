// Generated from contracts/out/USYCYieldVault.sol. Do not edit by hand.
export const usycAdapterAbi = [
 {"type":"constructor","inputs":[{"name":"teller_","type":"address","internalType":"address"},{"name":"depositor_","type":"address","internalType":"address"}],"stateMutability":"nonpayable"},
 {"type":"function","name":"asset","inputs":[],"outputs":[{"name":"","type":"address","internalType":"address"}],"stateMutability":"view"},
 {"type":"function","name":"convertToAssets","inputs":[{"name":"shares","type":"uint256","internalType":"uint256"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},
 {"type":"function","name":"convertToShares","inputs":[{"name":"assets","type":"uint256","internalType":"uint256"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},
 {"type":"function","name":"deposit","inputs":[{"name":"assets","type":"uint256","internalType":"uint256"},{"name":"receiver","type":"address","internalType":"address"}],"outputs":[{"name":"shares","type":"uint256","internalType":"uint256"}],"stateMutability":"nonpayable"},
 {"type":"function","name":"depositor","inputs":[],"outputs":[{"name":"","type":"address","internalType":"address"}],"stateMutability":"view"},
 {"type":"function","name":"redeem","inputs":[{"name":"shares","type":"uint256","internalType":"uint256"},{"name":"receiver","type":"address","internalType":"address"},{"name":"owner","type":"address","internalType":"address"}],"outputs":[{"name":"assets","type":"uint256","internalType":"uint256"}],"stateMutability":"nonpayable"},
 {"type":"function","name":"teller","inputs":[],"outputs":[{"name":"","type":"address","internalType":"contract IUSYCTeller"}],"stateMutability":"view"},
 {"type":"function","name":"totalShares","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},
 {"type":"function","name":"usdc","inputs":[],"outputs":[{"name":"","type":"address","internalType":"contract IERC20"}],"stateMutability":"view"},
 {"type":"function","name":"usyc","inputs":[],"outputs":[{"name":"","type":"address","internalType":"contract IERC20"}],"stateMutability":"view"},
 {"type":"event","name":"Deposited","inputs":[{"name":"assets","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"shares","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},
 {"type":"event","name":"Redeemed","inputs":[{"name":"shares","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"assets","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"receiver","type":"address","indexed":false,"internalType":"address"}],"anonymous":false},
 {"type":"error","name":"BadReceiver","inputs":[]},
 {"type":"error","name":"InsufficientShares","inputs":[]},
 {"type":"error","name":"NotDepositor","inputs":[]},
 {"type":"error","name":"ReentrancyGuardReentrantCall","inputs":[]},
 {"type":"error","name":"SafeERC20FailedOperation","inputs":[{"name":"token","type":"address","internalType":"address"}]},
 {"type":"error","name":"TellerMismatch","inputs":[]},
 {"type":"error","name":"ZeroAmount","inputs":[]}
] as const
