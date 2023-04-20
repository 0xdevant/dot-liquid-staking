// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import {IERC20Plus} from "./interfaces/IERC20Plus.sol";
import "./libraries/DataTypes.sol";

/**
 * @title LiquidStaking
 * @author 0xdevant
 * @notice This contract allows users on Astar to stake their Dot to receive 1:1 share of sDot in return.
 * Every sDot holder will be eligible for receiving Dot and reward tokens like ASTR as rewards based on their share of sDot to the total Dot in existence.
 * Whenever `updateReward(token)` is called, we recalculate the accRewardPerShare of reward tokens,
 * holders who are still holding sDot or have held sDot before will be able to claim their remaining reward using `harvest`
 */

contract LiquidStaking is Initializable, OwnableUpgradeable, PausableUpgradeable, ERC20Upgradeable {
    error NotAllowZeroAddress();
    error NotAuthorizedToWithdraw();
    error NotEnoughSDotBalance();
    error NoClaimableUnbondedDot();
    error NoUserStaking();
    error DepositAmountNotEqualPendingUnbondDot();
    error StakeAmountMustBeMoreThanTransactionFeeTwice();
    error UnstakeAmountMustBeMoreThanTransactionFee();
    error DuplicatedRewardToken();
    error RewardTokensExceedLimit();
    error RewardTokenNotExist();

    using SafeERC20Upgradeable for IERC20Upgradeable;

    IERC20Plus public dot;

    /// @notice Array of tokens that users can claim
    IERC20Upgradeable[] public rewardTokens;
    mapping(IERC20Upgradeable => bool) public isRewardToken;
    /// @notice Last reward balance of `token`
    mapping(IERC20Upgradeable => uint256) public lastRewardBalance;

    /// @notice Accumulated `token` rewards per share, scaled to `ACC_REWARD_PER_SHARE_PRECISION`
    mapping(IERC20Upgradeable => uint256) public accRewardPerShare;
    /// @notice The precision of `accRewardPerShare`
    uint256 public ACC_REWARD_PER_SHARE_PRECISION;

    uint256 public dotTransactionFee;

    /// @dev Internal balance of staked Dot, this gets updated on user deposits / withdrawals
    uint256 public internalDotBalance;
    uint256 public totalPendingBondAmount;

    /// @dev Info of each user that stakes Dot
    mapping(address => DataTypes.UserInfo) private userInfo;
    /// @dev Array of bonding infos containing each user's pending bond amount to let them unstake instantly if their DOTs haven't been bonded yet
    DataTypes.PendingBondUser[] private pendingBondUsers;

    /// @dev The address that receive the withdrawl fee from users' withdrawals
    address public feeCollector;
    /// @dev The address that withdraws Dot from this contract to stake on validators on relay chain
    address public operator;

    /**
     * @notice Initialize a new LiquidStaking contract
     * @dev This contract needs to receive an ERC20 `_rewardToken` in order to distribute them
     * (with MoneyMaker in our case)
     * @param _rewardToken The address of the ERC20 reward token(i.e. WASTR atm)
     * @param _dot The address of the Dot token, which is also the reward token to be distributed as sDot
     * @param _operator The address that withdraws Dot from this contract to stake on validators on relay chain
     */
    function initialize(
        IERC20Upgradeable _rewardToken,
        IERC20Plus _dot,
        address _feeCollector,
        address _operator
    ) external initializer {
        __Ownable_init();
        __ERC20_init("stakedDOT", "sDOT");
        if (
            address(_rewardToken) == address(0) ||
            address(_dot) == address(0) ||
            _feeCollector == address(0) ||
            _operator == address(0)
        ) {
            revert NotAllowZeroAddress();
        }

        dot = IERC20Plus(_dot);
        feeCollector = _feeCollector;
        operator = _operator;

        isRewardToken[_rewardToken] = true;
        rewardTokens.push(_rewardToken);
        ACC_REWARD_PER_SHARE_PRECISION = 1e24;
        dotTransactionFee = 0.035e10;
    }

    // Locks Dot and mints sDot
    function stake(uint256 _amount) external whenNotPaused {
        // times two because need to be bigger than total fee of both stake & unstake
        if (_amount <= dotTransactionFee * 2) revert StakeAmountMustBeMoreThanTransactionFeeTwice();

        uint256 _amountMinusFee = _amount - dotTransactionFee;

        DataTypes.UserInfo storage user = userInfo[_msgSender()];

        user.amount = user.amount + _amountMinusFee;

        bool hasUserStakedBefore = false;

        if (pendingBondUsers.length > 0) {
            // check if user already staked before this round's withdrawPendingBond to prevent excess unstake
            for (uint256 i = 0; i < pendingBondUsers.length; i++) {
                if (pendingBondUsers[i].user == _msgSender()) {
                    pendingBondUsers[i].amount = pendingBondUsers[i].amount + _amountMinusFee;
                    hasUserStakedBefore = true;
                    break;
                }
            }
        }

        if (!hasUserStakedBefore) {
            DataTypes.PendingBondUser memory pendingBondUser = DataTypes.PendingBondUser(_msgSender(), _amountMinusFee);
            pendingBondUsers.push(pendingBondUser);
        }

        internalDotBalance = internalDotBalance + _amountMinusFee;
        totalPendingBondAmount = totalPendingBondAmount + _amountMinusFee;

        // mint sDot 1:1 to the dot amount put in
        _mint(_msgSender(), _amountMinusFee);

        dot.transferFrom(_msgSender(), address(this), _amountMinusFee);
        // send withdrawal fee to feeCollector
        dot.transferFrom(_msgSender(), feeCollector, dotTransactionFee);

        emit Staked(_msgSender(), _amountMinusFee);
    }

    // Add up each user's pending unbonding amount and initiate unstake request for operator to withdraw, user will continue accrue sDot as long as they hold sDot on Astar
    function unstake(uint256 _amount) external {
        if (_amount <= dotTransactionFee) revert UnstakeAmountMustBeMoreThanTransactionFee();

        // Only allow unstake when user has same or larger amount of sDot than unstake amount
        if (balanceOf(_msgSender()) < _amount) revert NotEnoughSDotBalance();

        DataTypes.UserInfo storage user = userInfo[_msgSender()];

        // user.amount != 0 means user has staked Dot before, so update staked amount
        if (user.amount != 0) {
            if (_amount < user.amount) {
                user.amount = user.amount - _amount;
            } else {
                // means user has same or acquired more sDot after staked Dot, should clear staked amount
                user.amount = 0;
            }
        }

        internalDotBalance = internalDotBalance - _amount;

        // means user has staked Dot before + withdrawPendingBond is not called by operator yet(i.e. pendingBondUsers array is not cleared)
        if (pendingBondUsers.length > 0) {
            // check if unstaker still have DOTs left that are not yet bonded by operator, if so let unstaker claim back Dot instantly
            for (uint256 i = 0; i < pendingBondUsers.length; i++) {
                // if unstaker's Dot is not yet bonded by operator
                if (pendingBondUsers[i].user == _msgSender()) {
                    // user not unstaking all original pendingBond
                    if (_amount < pendingBondUsers[i].amount) {
                        // immediately subtract the amount of totalPendingBondAmount
                        totalPendingBondAmount = totalPendingBondAmount - _amount;
                        pendingBondUsers[i].amount = pendingBondUsers[i].amount - _amount;
                    } else if (_amount == pendingBondUsers[i].amount) {
                        // immediately subtract the amount of totalPendingBondAmount
                        totalPendingBondAmount = totalPendingBondAmount - _amount;
                        // unstake amount equal to original pendingBond
                        pendingBondUsers[i] = pendingBondUsers[pendingBondUsers.length - 1];
                        pendingBondUsers.pop();
                    } else if (_amount > pendingBondUsers[i].amount) {
                        // user unstaking more than original pendingBond amount after user buys sDot directly from market
                        // immediately subtract the amount of totalPendingBondAmount
                        totalPendingBondAmount = totalPendingBondAmount - pendingBondUsers[i].amount;

                        uint256 instantUnstakeAmount = pendingBondUsers[i].amount;

                        // remove user from pendingBond array(i.e. unstake instantly with the amount of user's all pendingBond)
                        pendingBondUsers[i] = pendingBondUsers[pendingBondUsers.length - 1];
                        pendingBondUsers.pop();

                        // first calculate the amount for initiating the unstake after deducting the original pendingBond amount
                        uint256 _amountMinusInstantUnstakeAmount = _amount - instantUnstakeAmount;
                        user.pendingUnbondAmount = user.pendingUnbondAmount + _amountMinusInstantUnstakeAmount;

                        // burn sDot 1:1 to the amount of dot withdrawal
                        _burn(_msgSender(), instantUnstakeAmount);

                        dot.transfer(_msgSender(), instantUnstakeAmount);

                        emit InstantUnstaked(_msgSender(), instantUnstakeAmount, block.timestamp);
                        emit Unstaked(_msgSender(), _amountMinusInstantUnstakeAmount, block.timestamp);
                        return;
                    }

                    // burn sDot 1:1 to the amount of dot withdrawal
                    _burn(_msgSender(), _amount);

                    dot.transfer(_msgSender(), _amount);

                    emit InstantUnstaked(_msgSender(), _amount, block.timestamp);

                    return;
                }
            }
        }
        // get to here means previous round of bonding request just completed(i.e. no pendingBond Dot left), awaiting next round
        user.pendingUnbondAmount = user.pendingUnbondAmount + _amount;

        // burn sDot 1:1 to the amount of dot withdrawal to make sure user cannot keep initiating unstake request with the same sDot balance
        _burn(_msgSender(), _amount);

        // reason to use _amount instead of _amountMinusFee is because we want operator to process the unbond with the undeducted amount to avoid operator's confusion on original staked amount that already minused fee,
        // then deduct withdrawl fee only when user claims Dot
        emit Unstaked(_msgSender(), _amount, block.timestamp);
    }

    // Claim back Dot 1:1 + gained Dot and burns sDot
    function claimDOT() external {
        DataTypes.UserInfo storage user = userInfo[_msgSender()];
        uint256 currClaimableUnbondedAmount = user.claimableUnbondedAmount;
        if (currClaimableUnbondedAmount == 0) revert NoClaimableUnbondedDot();

        user.claimableUnbondedAmount = 0;

        dot.transfer(_msgSender(), currClaimableUnbondedAmount);

        emit ClaimedUnbond(_msgSender(), currClaimableUnbondedAmount, block.timestamp);
    }

    // Harvest your ASTR reward.
    function harvest(IERC20Upgradeable _rewardToken) external {
        uint256 userSDotBalance = balanceOf(_msgSender());

        updateReward(_rewardToken);
        uint256 _rewardAmount = getPendingReward(_msgSender(), _rewardToken);
        userInfo[_msgSender()].unclaimedReward[_rewardToken] = 0;

        DataTypes.UserInfo storage user = userInfo[_msgSender()];
        user.rewardDebt[_rewardToken] =
            (userSDotBalance * accRewardPerShare[_rewardToken]) /
            ACC_REWARD_PER_SHARE_PRECISION;

        _safeTokenTransfer(_rewardToken, _msgSender(), _rewardAmount);

        emit Harvested(_msgSender(), address(_rewardToken), _rewardAmount);
    }

    /** Only multi-sig owner */
    // withdraw all DOTs that are pending to be bonded in order to stake in the relaychain
    function withdrawPendingBond() external onlyOwner whenNotPaused {
        if (totalPendingBondAmount <= 0) revert NoUserStaking();
        assert(dot.balanceOf(address(this)) >= totalPendingBondAmount);

        uint256 lastTotalPendingBondAmount = totalPendingBondAmount;
        totalPendingBondAmount = 0;

        delete pendingBondUsers;

        dot.transfer(operator, lastTotalPendingBondAmount);

        emit WithdrawedPendingBond(lastTotalPendingBondAmount, block.timestamp);
    }

    // deposit unbonded DOTs to contract and let individual user who initiated unstake request be able to claim back DOTs
    function depositUnbonded(address _user, uint256 _amount) external onlyOwner {
        DataTypes.UserInfo storage user = userInfo[_user];
        if (user.pendingUnbondAmount != _amount) revert DepositAmountNotEqualPendingUnbondDot();

        uint256 _amountMinusFee = _amount - dotTransactionFee;

        user.pendingUnbondAmount = user.pendingUnbondAmount - _amount;
        user.claimableUnbondedAmount = user.claimableUnbondedAmount + _amountMinusFee;

        dot.transferFrom(operator, address(this), _amountMinusFee);
        // send withdrawal fee from operator to feeCollector
        dot.transferFrom(operator, feeCollector, dotTransactionFee);

        emit DepositedUnbonded(_user, _amount, block.timestamp);
    }

    function setFeeCollector(address _newFeeCollector) external onlyOwner {
        if (address(_newFeeCollector) == address(0)) {
            revert NotAllowZeroAddress();
        }
        feeCollector = _newFeeCollector;

        emit NewFeeCollectorSet(_newFeeCollector);
    }

    function setOperator(address _newOperator) external onlyOwner {
        if (address(_newOperator) == address(0)) {
            revert NotAllowZeroAddress();
        }
        operator = _newOperator;

        emit NewOperatorSet(_newOperator);
    }

    function setTransactionFee(uint256 _newTransactionFee) external onlyOwner {
        dotTransactionFee = _newTransactionFee;

        emit NewTransactionFeeSet(_newTransactionFee);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Add a reward token
     * @param _rewardToken The address of the reward token
     */
    function addRewardToken(IERC20Upgradeable _rewardToken) external onlyOwner {
        if (isRewardToken[_rewardToken]) revert DuplicatedRewardToken();
        if (address(_rewardToken) == address(0)) revert NotAllowZeroAddress();
        if (rewardTokens.length >= 25) revert RewardTokensExceedLimit();
        rewardTokens.push(_rewardToken);
        isRewardToken[_rewardToken] = true;
        updateReward(_rewardToken);
        emit RewardTokenAdded(address(_rewardToken));
    }

    /**
     * @notice Remove a reward token
     * @param _rewardToken The address of the reward token
     */
    function removeRewardToken(IERC20Upgradeable _rewardToken) external onlyOwner {
        if (!isRewardToken[_rewardToken]) revert RewardTokenNotExist();

        updateReward(_rewardToken);
        isRewardToken[_rewardToken] = false;
        uint256 _len = rewardTokens.length;
        for (uint256 i; i < _len; i++) {
            if (rewardTokens[i] == _rewardToken) {
                rewardTokens[i] = rewardTokens[_len - 1];
                rewardTokens.pop();
                break;
            }
        }
        emit RewardTokenRemoved(address(_rewardToken));
    }

    /**
     * @notice Update reward variables
     * @param _token The address of the reward token
     * @dev Needs to be called before any deposit or withdrawal
     */
    function updateReward(IERC20Upgradeable _token) public {
        if (!isRewardToken[_token]) revert RewardTokenNotExist();

        uint256 _totalSDot = totalSupply();

        uint256 _rewardBalance = _token.balanceOf(address(this));

        // Did LiquidStaking receive any new reward token
        if (_rewardBalance == lastRewardBalance[_token] || _totalSDot == 0) {
            return;
        }

        uint256 _accruedReward = _rewardBalance - lastRewardBalance[_token];

        accRewardPerShare[_token] =
            accRewardPerShare[_token] +
            ((_accruedReward * ACC_REWARD_PER_SHARE_PRECISION) / _totalSDot);
        lastRewardBalance[_token] = _rewardBalance;
    }

    /** Getters */
    function getUserInfo(address _user, IERC20Upgradeable _rewardToken)
        external
        view
        returns (
            uint256,
            uint256,
            uint256,
            uint256,
            uint256
        )
    {
        DataTypes.UserInfo storage user = userInfo[_user];
        return (
            user.amount,
            user.pendingUnbondAmount,
            user.claimableUnbondedAmount,
            user.rewardDebt[_rewardToken],
            user.unclaimedReward[_rewardToken]
        );
    }

    /**
     * @notice View function to see pending reward token on frontend
     * @param _user The address of the user
     * @param _token The address of the token
     * @return `_user`'s pending reward token
     */
    function getPendingReward(address _user, IERC20Upgradeable _token) public view returns (uint256) {
        if (!isRewardToken[_token]) revert RewardTokenNotExist();

        DataTypes.UserInfo storage user = userInfo[_user];

        uint256 _totalSDot = totalSupply();
        uint256 userSDotBalance = balanceOf(_user);

        uint256 _accRewardTokenPerShare = accRewardPerShare[_token];
        uint256 _currRewardBalance = _token.balanceOf(address(this));

        if (_currRewardBalance != lastRewardBalance[_token] && _totalSDot != 0) {
            uint256 _accruedReward = _currRewardBalance - lastRewardBalance[_token];
            _accRewardTokenPerShare =
                _accRewardTokenPerShare +
                ((_accruedReward * ACC_REWARD_PER_SHARE_PRECISION) / _totalSDot);
        }

        return
            user.unclaimedReward[_token] +
            (userSDotBalance * _accRewardTokenPerShare) /
            ACC_REWARD_PER_SHARE_PRECISION -
            user.rewardDebt[_token];
    }

    /**
     * @notice Get the number of reward tokens
     * @return The length of the array
     */
    function getRewardTokensLength() external view returns (uint256) {
        return rewardTokens.length;
    }

    /** Internal */
    /**
     * @notice Safe token transfer function, just in case if rounding error
     * causes pool to not have enough reward tokens
     * @param _token The address of that token to transfer
     * @param _to The address that will receive `_amount` `rewardToken`
     * @param _amount The amount to send to `_to`
     */
    function _safeTokenTransfer(
        IERC20Upgradeable _token,
        address _to,
        uint256 _amount
    ) internal {
        uint256 _currRewardBalance = _token.balanceOf(address(this));
        uint256 _rewardBalance = _currRewardBalance;

        if (_amount > _rewardBalance) {
            lastRewardBalance[_token] = lastRewardBalance[_token] - _rewardBalance;
            _token.safeTransfer(_to, _rewardBalance);
        } else {
            lastRewardBalance[_token] = lastRewardBalance[_token] - _amount;
            _token.safeTransfer(_to, _amount);
        }
    }

    /** sDot */
    function decimals() public view virtual override returns (uint8) {
        return 10;
    }

    // keep track of transferral between users to ensure users' rewards are updated accordingly
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal override {
        // normal transfer between users scenario already included if pass both conditions

        // if burn sDot from user
        if (from != address(0)) {
            DataTypes.UserInfo storage transferer = userInfo[from];
            uint256 transfererSDotBalance = balanceOf(from);
            // assume user's new sDot balance after transfer successfully
            uint256 _transfererNewSDotBalance = transfererSDotBalance - amount;

            for (uint256 i; i < rewardTokens.length; i++) {
                IERC20Upgradeable _token = rewardTokens[i];
                updateReward(_token);

                if (transfererSDotBalance != 0) {
                    uint256 _transfererPending = (transfererSDotBalance * accRewardPerShare[_token]) /
                        ACC_REWARD_PER_SHARE_PRECISION -
                        transferer.rewardDebt[_token];

                    if (_transfererPending != 0) {
                        transferer.unclaimedReward[_token] = transferer.unclaimedReward[_token] + _transfererPending;
                    }
                }

                transferer.rewardDebt[_token] =
                    (_transfererNewSDotBalance * accRewardPerShare[_token]) /
                    ACC_REWARD_PER_SHARE_PRECISION;
            }
        }

        // if mint sDot to user
        if (to != address(0)) {
            DataTypes.UserInfo storage transferee = userInfo[to];
            uint256 transfereeSDotBalance = balanceOf(to);
            // assume user's new sDot balance after transfer successfully
            uint256 _transfereeNewSDotBalance = transfereeSDotBalance + amount;

            for (uint256 i; i < rewardTokens.length; i++) {
                IERC20Upgradeable _token = rewardTokens[i];
                updateReward(_token);

                if (transfereeSDotBalance != 0) {
                    uint256 _transfereePending = (transfereeSDotBalance * accRewardPerShare[_token]) /
                        ACC_REWARD_PER_SHARE_PRECISION -
                        transferee.rewardDebt[_token];

                    if (_transfereePending != 0) {
                        transferee.unclaimedReward[_token] = transferee.unclaimedReward[_token] + _transfereePending;
                    }
                }

                transferee.rewardDebt[_token] =
                    (_transfereeNewSDotBalance * accRewardPerShare[_token]) /
                    ACC_REWARD_PER_SHARE_PRECISION;
            }
        }
    }

    /** Events */
    /// @notice Emitted when a user stakes Dot
    event Staked(address indexed user, uint256 amount);

    /// @notice Emitted only when a user unstakes Dot instanly(i.e. without operator having withdrawn pending bond)
    event InstantUnstaked(address indexed user, uint256 amount, uint256 timestamp);

    /// @notice Emitted when a user unstakes Dot
    event Unstaked(address indexed user, uint256 amount, uint256 timestamp);

    /// @notice Emitted when a user claims back Dot after unbonding period ends
    event ClaimedUnbond(address indexed user, uint256 amount, uint256 timestamp);

    /// @notice Emitted when a user harvests ASTR rewards
    event Harvested(address indexed user, address indexed rewardToken, uint256 amount);

    /// @notice Emitted when operator withdraws all pending bond Dot from contract
    event WithdrawedPendingBond(uint256 lastTotalPendingBondAmount, uint256 timestamp);

    /// @notice Emitted when operator deposits unbonded Dot to contract
    event DepositedUnbonded(address indexed user, uint256 amount, uint256 timestamp);

    /// @notice Emitted when owner adds a token to the reward tokens list
    event RewardTokenAdded(address token);

    /// @notice Emitted when owner removes a token from the reward tokens list
    event RewardTokenRemoved(address token);

    /// @notice Emitted when owner sets a new feeCollector
    event NewFeeCollectorSet(address newFeeCollector);

    /// @notice Emitted when owner sets a new operator
    event NewOperatorSet(address newOperator);

    /// @notice Emitted when owner sets a new transaction fee
    event NewTransactionFeeSet(uint256 newTransactionFee);
}
