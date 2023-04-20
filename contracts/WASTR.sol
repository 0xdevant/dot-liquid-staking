//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract WASTR is Ownable, IERC20 {
    string public name = "Wrapped Astar";
    string public symbol = "WASTR";
    uint8 public decimals = 18;

    event Deposit(address indexed dst, uint256 wad);
    event Withdrawal(address indexed src, uint256 wad);

    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override allowance;

    receive() external payable {
        deposit();
    }

    function deposit() public payable {
        balanceOf[_msgSender()] += msg.value;
        emit Deposit(_msgSender(), msg.value);
    }

    function withdraw(uint256 wad) public {
        require(balanceOf[_msgSender()] >= wad, "INSUFFICIENT_BALANCE");
        balanceOf[_msgSender()] -= wad;
        payable(_msgSender()).transfer(wad);
        emit Withdrawal(_msgSender(), wad);
    }

    function totalSupply() public view override returns (uint256) {
        return address(this).balance;
    }

    function approve(address guy, uint256 wad) public override returns (bool) {
        allowance[_msgSender()][guy] = wad;
        emit Approval(_msgSender(), guy, wad);
        return true;
    }

    function transfer(address dst, uint256 wad) public override returns (bool) {
        return transferFrom(_msgSender(), dst, wad);
    }

    function transferFrom(
        address src,
        address dst,
        uint256 wad
    ) public override returns (bool) {
        require(balanceOf[src] >= wad, "INSUFFICIENT_BALANCE");

        if (src != _msgSender()) {
            require(allowance[src][_msgSender()] >= wad, "INSUFFICIENT_ALLOWANCE");
            allowance[src][_msgSender()] -= wad;
        }

        balanceOf[src] -= wad;
        balanceOf[dst] += wad;

        emit Transfer(src, dst, wad);

        return true;
    }

    /** Only owner */
    /**
     * @notice Only use this when there are excessive ASTR transferred to this contract
     */
    function recover() external onlyOwner {
        _recover(_msgSender());
    }

    /**
     * @dev Mint wrapped token to cover any underlyingTokens that would have been transferred by mistake. Internal
     * function that can be exposed with access control if desired.
     */
    function _recover(address account) internal returns (uint256) {
        uint256 value = address(this).balance - totalSupply();
        balanceOf[account] += value;
        return value;
    }
}
