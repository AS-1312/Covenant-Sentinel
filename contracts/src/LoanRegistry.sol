// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {IReceiverTemplate} from "./interfaces/IReceiverTemplate.sol";

contract LoanRegistry is IReceiverTemplate {
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

    event LoanRegistered(
        bytes32 indexed loanId,
        address indexed tokenAddress,
        uint256 principalAmount,
        uint256 covenantCount,
        uint256 timestamp
    );

    event CovenantAdded(
        bytes32 indexed loanId,
        string covenantName,
        uint256 threshold,
        string thresholdType
    );
    
    event CovenantUpdated(
        bytes32 indexed loanId,
        string covenantName,
        uint256 newThreshold
    );
    
    event CovenantDeactivated(
        bytes32 indexed loanId,
        string covenantName
    );

    error LoanNotRegistered(bytes32 loanId);
    error LoanAlreadyRegistered(bytes32 loanId);
    error ConvenantNotFound(bytes32 loanId, string covenantName);
    error InvalidCovenantArray();
    error InvalidTokenAddress();

    modifier loanExists(bytes32 loanId) {
        _loanExists(loanId);
        _;
    }


    constructor(
        address _expectedAuthor,
        bytes10 _expectedWorkflowName
    ) IReceiverTemplate(_expectedAuthor, _expectedWorkflowName) {}

    /**
     * @notice Receive report from Forwarder
     * @param metadata Encoded metadata (not used in testing version)
     * @param report Encoded report containing loan and covenant details
     */
    function onReport(bytes calldata metadata, bytes calldata report) external override {        
        _processReport(report);
    }

    /**
     * @notice Process the mint or redeem instruction
     * @param report ABI-encoded report containing loan and covenant details
     */
    function _processReport(bytes calldata report) internal override {
        // Decode the report
        (bytes32 loanId,
        address tokenAddress,
        uint256 principalAmount,
        uint256 reportingFrequency,
        string[] memory covenantNames,
        string[] memory metricDefinitions,
        uint256[] memory thresholds,
        string[] memory thresholdTypes,
        string[] memory ebitdaAdjustments) = abi.decode(
            report,
            (bytes32, address, uint256, uint256, string[], string[] , uint256[], string[], string[])
        );
        
        _registerLoan(
            loanId,
            tokenAddress,
            principalAmount,
            reportingFrequency,
            covenantNames,
            metricDefinitions,
            thresholds,
            thresholdTypes,
            ebitdaAdjustments
        );
    }

    /**
     * @notice Register a new loan with its covenant schema
     * @param loanId Unique identifier for the loan
     * @param tokenAddress Address of the tokenized loan
     * @param principalAmount Original loan principal (scaled by 1e18)
     * @param reportingFrequency How often covenants should be checked (in seconds)
     * @param covenantNames Array of covenant names
     * @param metricDefinitions Array of metric calculation definitions
     * @param thresholds Array of threshold values (scaled by 1e18)
     * @param thresholdTypes Array of threshold types ("MAX" or "MIN")
     * @param ebitdaAdjustments Array of EBITDA calculation rules
     */
    function _registerLoan(
        bytes32 loanId,
        address tokenAddress,
        uint256 principalAmount,
        uint256 reportingFrequency,
        string[] memory covenantNames,
        string[] memory metricDefinitions,
        uint256[] memory thresholds,
        string[] memory thresholdTypes,
        string[] memory ebitdaAdjustments
    ) private {
        if (loanSchemas[loanId].exists) {
            revert LoanAlreadyRegistered(loanId);
        }
        if (tokenAddress == address(0)) {
            revert InvalidTokenAddress();
        }
        if (covenantNames.length == 0) {
            revert InvalidCovenantArray();
        }
        if (
            covenantNames.length != metricDefinitions.length ||
            covenantNames.length != thresholds.length ||
            covenantNames.length != thresholdTypes.length ||
            covenantNames.length != ebitdaAdjustments.length
        ) {
            revert InvalidCovenantArray();
        }
        
        LoanSchema storage schema = loanSchemas[loanId];
        schema.loanId = loanId;
        schema.tokenAddress = tokenAddress;
        schema.principalAmount = principalAmount;
        schema.onboardingTimestamp = block.timestamp;
        schema.reportingFrequency = reportingFrequency;
        schema.exists = true;
        
        for (uint256 i = 0; i < covenantNames.length; i++) {
            schema.covenantNames.push(covenantNames[i]);
            schema.covenants[covenantNames[i]] = Covenant({
                name: covenantNames[i],
                metricDefinition: metricDefinitions[i],
                threshold: thresholds[i],
                thresholdType: thresholdTypes[i],
                ebitdaAdjustments: ebitdaAdjustments[i],
                isActive: true
            });
            
            emit CovenantAdded(loanId, covenantNames[i], thresholds[i], thresholdTypes[i]);
        }
        
        registeredLoans.push(loanId);
        
        emit LoanRegistered(
            loanId,
            tokenAddress,
            principalAmount,
            covenantNames.length,
            block.timestamp
        );
    }

    /**
     * @notice Update a covenant threshold
     */
    function updateCovenantThreshold(
        bytes32 loanId,
        string calldata covenantName,
        uint256 newThreshold
    ) public loanExists(loanId) {
        Covenant storage covenant = loanSchemas[loanId].covenants[covenantName];
        if (bytes(covenant.name).length == 0) {
            revert ConvenantNotFound(loanId, covenantName);
        }
        
        covenant.threshold = newThreshold;
        emit CovenantUpdated(loanId, covenantName, newThreshold);
    }
    
    /**
     * @notice Deactivate a covenant (stop monitoring)
     */
    function deactivateCovenant(
        bytes32 loanId,
        string calldata covenantName
    ) public loanExists(loanId) {
        Covenant storage covenant = loanSchemas[loanId].covenants[covenantName];
        if (bytes(covenant.name).length == 0) {
            revert ConvenantNotFound(loanId, covenantName);
        }
        
        covenant.isActive = false;
        emit CovenantDeactivated(loanId, covenantName);
    }

    /**
     * @notice Get complete loan schema
     */
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
    
    /**
     * @notice Get specific covenant details
     */
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

    /**
     * @notice Get all covenant names for a loan
     */
    function getCovenantNames(bytes32 loanId)
        public
        view
        loanExists(loanId)
        returns (string[] memory)
    {
        return loanSchemas[loanId].covenantNames;
    }
    
    /**
     * @notice Get total number of registered loans
     */
    function getRegisteredLoanCount() public view returns (uint256) {
        return registeredLoans.length;
    }
    
    /**
     * @notice Check if a loan is registered
     */
    function isLoanRegistered(bytes32 loanId) public view returns (bool) {
        return loanSchemas[loanId].exists;
    }

    function _loanExists(bytes32 loanId) internal view {
        if (!loanSchemas[loanId].exists) {
            revert LoanNotRegistered(loanId);
        }
    }

    /**
     * @notice ERC165 interface support.
     * @dev Overrides PolicyProtected's supportsInterface to include CRE receiver interface.
     * @param interfaceId The interface identifier to check.
     * @return True if the interface is supported.
     */
    function supportsInterface(bytes4 interfaceId) 
        public 
        pure 
        virtual 
        override 
        returns (bool) 
    {
        return interfaceId == this.onReport.selector || super.supportsInterface(interfaceId);
    }
}