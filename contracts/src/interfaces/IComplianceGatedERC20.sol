// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IComplianceGatedERC20 {
    function getLoanId() external view returns (bytes32);
}
