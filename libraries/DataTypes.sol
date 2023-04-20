// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

library DataTypes {
    /// @notice Info of each user
    struct UserInfo {
        uint256 amount;
        uint256 pendingUnbondAmount;
        uint256 claimableUnbondedAmount;
        mapping(IERC20Upgradeable => uint256) rewardDebt;
        mapping(IERC20Upgradeable => uint256) unclaimedReward;
        /**
         * @notice We do some fancy math here. Basically, any point in time, the amount of sDots and ASTRs
         * entitled to a user but is pending to be distributed is:
         *
         *   pendingReward = user.unclaimedReward + (user.sDotBalance * accRewardPerShare) - user.rewardDebt[token]
         *
         * Whenever a user has update on balance of sDot(via transfer/mint/burn etc). Here's what happens:
         *   1. accRewardPerShare (and `lastRewardBalance`) gets updated
         *   2. User's `unclaimedReward[token]` gets updated by accumulating pendingReward
         *   3. User's `amount` gets updated
         *   4. User's `rewardDebt[token]` gets updated
         */
    }

    /// @notice Keep track of bonding status for each user
    struct PendingBondUser {
        address user;
        uint256 amount;
    }
}
