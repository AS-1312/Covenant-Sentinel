// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {IPolicyEngine} from "@chainlink/policy-management/interfaces/IPolicyEngine.sol";
import {Policy} from "@chainlink/policy-management/core/Policy.sol";
import {ILoanHealthFeed} from "../interfaces/ILoanHealthFeed.sol";
import {IComplianceGatedERC20} from "../interfaces/IComplianceGatedERC20.sol";

contract LoanHealthPolicy is Policy {
    string public constant override typeAndVersion = "LoanHealthPolicy 1.0.0";

    ILoanHealthFeed public loanHealthFeed;

    function configure(bytes calldata parameters) internal override onlyInitializing {
        if (parameters.length == 0) {
            return;
        }
        
        address loanHealthFeedAddress = abi.decode(parameters, (address));
        require(loanHealthFeedAddress != address(0), "LoanHealthPolicy: Invalid feed address");
        loanHealthFeed = ILoanHealthFeed(loanHealthFeedAddress);
    }

    function setLoanHealthFeed(address _loanHealthFeed) external onlyOwner {
        require(_loanHealthFeed != address(0), "LoanHealthPolicy: Invalid feed address");
        loanHealthFeed = ILoanHealthFeed(_loanHealthFeed);
    }

    function run(
        address, // caller
        address subject,
        bytes4, // selector
        bytes[] calldata, // parameters
        bytes calldata // context
    )
        public
        view
        override
        returns (IPolicyEngine.PolicyResult)
    {
        IComplianceGatedERC20 token = IComplianceGatedERC20(subject);
        require(address(loanHealthFeed) != address(0), "LoanHealthPolicy: Feed not configured");
        bytes32 loanId = token.getLoanId();
        (
            ILoanHealthFeed.CovenantStatus overallStatus,
            ,
            ,
            ,
            ,
            ,

        ) = loanHealthFeed.getLatestReport(loanId);

        // If the feed indicates a breach, reject the transaction.
        if (overallStatus == ILoanHealthFeed.CovenantStatus.BREACH) {
            revert IPolicyEngine.PolicyRejected(
                "LoanHealthPolicy: Loan is in breach"
            );
        }        

        // Otherwise, continue to the next policy.
        return IPolicyEngine.PolicyResult.Continue;
    }
}