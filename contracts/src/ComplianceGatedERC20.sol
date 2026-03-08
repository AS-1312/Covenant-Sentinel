// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {PolicyProtected} from "@chainlink/policy-management/core/PolicyProtected.sol";

contract ComplianceGatedERC20 is ERC20, Ownable, PolicyProtected {
    bytes32 immutable _loanId;

    constructor(address initialOwner, address policyEngine, bytes32 loanId)
        ERC20("Private Credit Token", "PCT")
        PolicyProtected(initialOwner, policyEngine)
    {
        _loanId = loanId;
        _mint(initialOwner, 1000000 * 10 ** decimals());
    }

    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }

    function transfer(address recipient, uint256 amount) public runPolicy override returns (bool) {
        return super.transfer(recipient, amount);
    }

    function getLoanId() public view returns (bytes32) {
        return _loanId;
    }
}
