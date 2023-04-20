//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.4;

import "../interfaces/IERC20PlusUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

contract MockXC20UpgradeableContract is ERC20Upgradeable, IERC20PlusUpgradeable {
    function initialize(string memory name_, string memory symbol_) public initializer {
        __ERC20_init(name_, symbol_);
    }

    function decimals() public view virtual override(ERC20Upgradeable, IERC20PlusUpgradeable) returns (uint8) {
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
