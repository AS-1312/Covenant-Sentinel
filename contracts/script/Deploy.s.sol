// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {LoanHealthFeed} from "../src/LoanHealthFeed.sol";
import {LoanRegistry} from "../src/LoanRegistry.sol";

contract DeployScript is Script {
    LoanHealthFeed public loanHealthFeed;
    LoanRegistry public loanRegistry;

    function setUp() public {}

    function run() public {
        vm.startBroadcast();

        address workflowAddress = 0x1234567890123456789012345678901234567890; // Replace with actual workflow address

        loanRegistry = new LoanRegistry(workflowAddress);
        loanHealthFeed = new LoanHealthFeed(workflowAddress);

        vm.stopBroadcast();
    }
}
