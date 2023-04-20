//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract BackUpWASTR is Ownable, ERC20 {
    constructor(string memory _name, string memory _symbol) ERC20(_name, _symbol) {}

    /**
     * @dev Allow a user to deposit underlying tokens and mint the corresponding number of wrapped tokens.
     */
    function depositFor(address account) public payable returns (bool) {
        require(msg.value > 0, "Deposit amount smaller or equal to 0");
        _mint(account, msg.value);
        return true;
    }

    /**
     * @dev Allow a user to burn a number of wrapped tokens and withdraw the corresponding number of underlying tokens.
     */
    function withdrawTo(address account, uint256 amount) public returns (bool) {
        _burn(_msgSender(), amount);
        payable(account).transfer(amount);
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
        _mint(account, value);
        return value;
    }
}
