// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.22;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {PolicyEngine} from "@chainlink/policy-management/core/PolicyEngine.sol";
import {Policy} from "@chainlink/policy-management/core/Policy.sol";
import {ComplianceGatedERC20} from "../src/ComplianceGatedERC20.sol";
import {LoanHealthPolicy} from "../src/policies/LoanHealthPolicy.sol";

contract DeployPolicyContracts is Script {
    function run() external {
        uint256 deployerPK = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPK);

        vm.startBroadcast(deployerPK);

        // 1. Deploy the PolicyEngine through a proxy
        PolicyEngine policyEngineImpl = new PolicyEngine();
        bytes memory policyEngineData = abi.encodeWithSelector(
            PolicyEngine.initialize.selector,
            true,  // defaultAllow = true (allow by default)
            deployer
        );
        ERC1967Proxy policyEngineProxy = new ERC1967Proxy(address(policyEngineImpl), policyEngineData);
        PolicyEngine policyEngine = PolicyEngine(address(policyEngineProxy));

        // 2. Deploy ComplianceGatedERC20 token implementation (no proxy needed since it's not upgradable)
        bytes32 loanId = 0x5072697661746563726564697431000000000000000000000000000000000000; // "Privatecredit1" padded to 32 bytes
        ComplianceGatedERC20 token = new ComplianceGatedERC20(deployer, address(policyEngine), loanId);

        // 3. Deploy the LoanHealthPolicy through a proxy
        LoanHealthPolicy loanHealthPolicyImpl = new LoanHealthPolicy();
        address loanHealthFeedAddress = 0xeC15EC785A6b234584bD7206843ED0F64a47cF2B; // Replace with actual feed address
        bytes memory loanHealthPolicyConfig = abi.encode(loanHealthFeedAddress);
        bytes memory loanHealthPolicyData = abi.encodeWithSelector(
            Policy.initialize.selector,
            address(policyEngine),
            deployer,
            loanHealthPolicyConfig
        );
        ERC1967Proxy loanHealthPolicyProxy = new ERC1967Proxy(address(loanHealthPolicyImpl), loanHealthPolicyData);
        LoanHealthPolicy loanHealthPolicy = LoanHealthPolicy(address(loanHealthPolicyProxy));

        // 4. Add the LoanHealthPolicy to the PolicyEngine
        policyEngine.addPolicy(
            address(token),
            token.transfer.selector,
            address(loanHealthPolicy),
            new bytes32[](0) // No parameters needed for LoanHealthPolicy
        );

        vm.stopBroadcast();

        console.log("--- Deployed Contracts ---");
        console.log("ComplianceGatedERC20 deployed at:", address(token));
        console.log("PolicyEngine deployed at:", address(policyEngine));
        console.log("LoanHealthPolicy deployed at:", address(loanHealthPolicy));
    }
}