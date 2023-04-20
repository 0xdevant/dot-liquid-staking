//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.4;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

interface IERC20PlusUpgradeable is IERC20Upgradeable {
    function mint(address beneficiary, uint256 amount) external returns (bool);

    function burn(address who, uint256 amount) external returns (bool);

    function decimals() external view returns (uint8);
}
