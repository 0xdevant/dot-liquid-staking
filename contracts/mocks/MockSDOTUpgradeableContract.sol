//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.4;

import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20WrapperUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/draft-ERC20PermitUpgradeable.sol";
import "./MockERC20UpgradeableContract.sol";
import "../interfaces/IERC20PlusUpgradeable.sol";

contract MockSDOTUpgradeableContract is ERC20WrapperUpgradeable, ERC20PermitUpgradeable, IERC20PlusUpgradeable {
    function initialize(
        string memory name_,
        string memory symbol_,
        IERC20Upgradeable _dot
    ) public initializer {
        __ERC20_init(name_, symbol_);
        __ERC20Permit_init(name_);
        __ERC20Wrapper_init(_dot);
    }

    function decimals()
        public
        view
        virtual
        override(ERC20WrapperUpgradeable, ERC20Upgradeable, IERC20PlusUpgradeable)
        returns (uint8)
    {
        return 10;
    }

    function mint(address _to, uint256 _amount) external override returns (bool) {
        _mint(_to, _amount);

        return true;
    }

    function burn(address _account, uint256 _amount) external override returns (bool) {
        _burn(_account, _amount);

        return true;
    }

    receive() external payable {}
}
