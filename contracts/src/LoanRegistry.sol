// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

contract LoanRegistry is Ownable {
    struct Covenant {
        string name;                    // e.g., "Maximum Leverage Ratio"
        string metricDefinition;        // e.g., "Total Debt / EBITDA"
        uint256 threshold;              // Scaled by 1e18 (e.g., 4.5x = 4.5e18)
        string thresholdType;           // "MAX" or "MIN"
        string ebitdaAdjustments;       // Bespoke add-backs/exclusions
        bool isActive;                  // Whether this covenant is currently monitored
    }

    struct LoanSchema {
        bytes32 loanId;                 // Unique identifier for the loan
        address tokenAddress;           // Address of the tokenized loan
        uint256 principalAmount;        // Original loan principal (scaled by 1e18)
        uint256 onboardingTimestamp;    // When schema was registered
        uint256 reportingFrequency;     // In seconds (e.g., 30 days = 2592000)
        string[] covenantNames;         // Array of covenant names for iteration
        mapping(string => Covenant) covenants;  // Covenant name => Covenant data
        bool exists;                    // Whether this loan is registered
    }
    
    mapping(bytes32 => LoanSchema) private loanSchemas;

    bytes32[] public registeredLoans;

    modifier loanExists(bytes32 loanId) {
        _loanExists(loanId);
        _;
    }

    error LoanNotRegistered(bytes32 loanId);
    error ConvenantNotFound(bytes32 loanId, string covenantName);


    constructor(address initialOwner) Ownable(initialOwner) {}

    function getLoanSchema(bytes32 loanId)
        public
        view
        loanExists(loanId)
        returns (
            address tokenAddress,
            uint256 principalAmount,
            uint256 onboardingTimestamp,
            uint256 reportingFrequency,
            string[] memory covenantNames
        )
    {
        LoanSchema storage schema = loanSchemas[loanId];
        return (
            schema.tokenAddress,
            schema.principalAmount,
            schema.onboardingTimestamp,
            schema.reportingFrequency,
            schema.covenantNames
        );
    }
    
    function getCovenant(bytes32 loanId, string calldata covenantName)
        public
        view
        loanExists(loanId)
        returns (
            string memory name,
            string memory metricDefinition,
            uint256 threshold,
            string memory thresholdType,
            string memory ebitdaAdjustments,
            bool isActive
        )
    {
        Covenant memory covenant = loanSchemas[loanId].covenants[covenantName];
        if (bytes(covenant.name).length == 0) {
            revert ConvenantNotFound(loanId, covenantName);
        }
        
        return (
            covenant.name,
            covenant.metricDefinition,
            covenant.threshold,
            covenant.thresholdType,
            covenant.ebitdaAdjustments,
            covenant.isActive
        );
    }

    function getCovenantNames(bytes32 loanId)
        public
        view
        loanExists(loanId)
        returns (string[] memory)
    {
        return loanSchemas[loanId].covenantNames;
    }
    
    function getRegisteredLoanCount() public view returns (uint256) {
        return registeredLoans.length;
    }
    
    function isLoanRegistered(bytes32 loanId) public view returns (bool) {
        return loanSchemas[loanId].exists;
    }

    function _loanExists(bytes32 loanId) internal view {
        if (!loanSchemas[loanId].exists) {
            revert LoanNotRegistered(loanId);
        }
    }
}