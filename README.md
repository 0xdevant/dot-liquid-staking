# Liquid Staking Contract

This contract allows users on Astar to stake their DOT to receive a share of sDot based on their amount of the total deposited DOT. Every time `updateReward(token)` is called, we distribute WASTR as rewards to users that are currently staking inside this contract, and they can claim it using `harvest`, and operator will call `withdrawPendingBond` with a fixed interval to withdraw all DOTs that are pending to be bonded in order to stake in the relaychain, operator will also call `depositUnbonded` with a fixed interval to individully distribute to users that have already initiated unstake request in order to claim back their DOT.

## Deployed

| Environment | Address                                    |
| ----------- | ------------------------------------------ |
| Shibuya     | 0x636F98F63501b72B2916338B903834124845DA81 |
| ASTAR       | 0xF8d6A9071f54CF9A802De7E2f672A549E089CCD3 |

## Usage

### DOT & sDOT

Please note that both DOT & sDOT are haveing only **10** decimals.

| Method                 | Usage                                                               |
| ---------------------- | ------------------------------------------------------------------- |
| `balanceOf(_account)`  | sDOT balance                                                        |
| `totalSupply()`        | Total issuance of sDOT                                              |
| `internalDotBalance()` | Total staked DOT, this gets updated on user `stake()` / `unstake()` |

### Getter functions

| Method                                     | Usage                                                                 | Return                                                                                                                                                                                  |
| ------------------------------------------ | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getUserInfo(_account, _rewardToken)`      | Get user info with reward respective to each reward token(i.e. WASTR) | `uint256 amount, uint256 pendingUnbondAmount, uint256 claimableUnbondedAmount, mapping(IERC20Upgradeable => uint256) rewardDebt, mapping(IERC20Upgradeable => uint256) unclaimedReward` |
| `getPendingReward(_account, _rewardToken)` | Get pending reward of an user                                         | `uint256 pendingReward`                                                                                                                                                                 |
| `getRewardTokensLength()`                  | Get the number of reward tokens                                       | `uint256 rewardTokensLength`                                                                                                                                                            |

#### APY

```
WASTR APY = Daily WASTR Rate * 365 / internalDOTBalance()
```

### LiquidStaking

| Method                  | Usage                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `stake(_amount)`        | Stake DOT                                                                                                                             |
| `unstake(_amount)`      | Unstake DOT(i.e. Unstake instantly/Add up each user's pending unbonding amount and initiate unstake request for operator to withdraw) |
| `harvest(_rewardToken)` | Harvest particular reward token                                                                                                       |
| `claimDOT()`            | Claim back DOT 1:1 + gained DOT and burns sDot                                                                                        |

### Owner-only functions (with timelock implemented)

| Method                                  | Usage                                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `withdrawPendingBond()`                 | Withdraw all DOTs that are pending to be bonded in order to stake in the relaychain                                |
| `depositUnbonded(_account, _amount)`    | Deposit unbonded DOTs to contract and let individual user who initiated unstake request be able to claim back DOTs |
| `setOperator(_operator)`                | Change operator's address                                                                                          |
| `setTransactionFee(_newTransactionFee)` | Change dot transaction fee                                                                                         |
| `pause()`                               | Implement an emergency stop mechanism to the contract                                                              |
| `unpause()`                             | Unpause the contract to return its state to normal                                                                 |
| `addRewardToken(_rewardToken)`          | Add token as Reward Token                                                                                          |
| `removeRewardToken(_rewardToken)`       | Remove token from Reward Token List                                                                                |

#### Event types

| Events                                                                         | Description                                                                                         |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `Staked(address indexed user, uint256 amount)`                                 | Emitted when a user stakes DOT                                                                      |
| `InstantUnstaked(address indexed user, uint256 amount, uint256 timestamp)`     | Emitted only when a user unstakes DOT instanly(i.e. without operator having withdrawn pending bond) |
| `Unstaked(address indexed user, uint256 amount, uint256 timestamp)`            | Emitted when a user unstakes DOT                                                                    |
| `ClaimedUnbond(address indexed user, uint256 amount, uint256 timestamp)`       | Emitted when a user claims back DOT after unbonding period ends                                     |
| `Harvested(address indexed user, address indexed rewardToken, uint256 amount)` | Emitted when a user harvests ASTR rewards                                                           |
| `WithdrawedPendingBond(uint256 totalPendingBondAmount, uint256 timestamp)`     | Emitted when operator withdraws all pending bond DOT from contract                                  |
| `DepositedUnbonded(address indexed user, uint256 amount, uint256 timestamp)`   | Emitted when operator deposits unbonded DOT to contract                                             |
| `NewFeeCollectorSet(address newFeeCollector)`                                  | Emitted when owner sets a new feeCollector                                                          |
| `NewOperatorSet(address newOperator)`                                          | Emitted when owner sets a new operator                                                              |
| `NewTransactionFeeSet(uint256 newTransactionFee)`                              | Emitted when owner sets a new transaction fee                                                       |
| `RewardTokenAdded(address token)`                                              | Emitted when owner adds a token to the reward tokens list                                           |
| `RewardTokenRemoved(address token)`                                            | Emitted when owner removes a token from the reward tokens list                                      |
