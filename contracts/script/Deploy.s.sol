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

        loanRegistry = new LoanRegistry(address(0), bytes10("dummy"));
        loanHealthFeed = new LoanHealthFeed(address(0), bytes10("dummy"));

        vm.stopBroadcast();
    }
}
