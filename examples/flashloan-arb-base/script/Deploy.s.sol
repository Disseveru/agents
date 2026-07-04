// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {FlashLoanArbitrage} from "../src/FlashLoanArbitrage.sol";

/// @notice Deploy FlashLoanArbitrage on Base mainnet.
/// forge script script/Deploy.s.sol:Deploy --rpc-url $BASE_RPC_ENDPOINT --broadcast
contract Deploy is Script {
    address constant AAVE_POOL = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;
    address constant AAVE_ADDRESSES_PROVIDER =
        0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D;

    function run() external {
        address owner = vm.envAddress("FLASHLOAN_OWNER");
        vm.startBroadcast();
        FlashLoanArbitrage arb = new FlashLoanArbitrage(
            AAVE_POOL,
            AAVE_ADDRESSES_PROVIDER,
            owner
        );
        vm.stopBroadcast();
        console2.log("FlashLoanArbitrage", address(arb));
        console2.log("owner", owner);
    }
}
