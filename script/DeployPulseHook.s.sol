// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {PulseHook} from "../contracts/PulseHook.sol";

contract DeployPulseHook is Script {
    address internal constant XLAYER_POOL_MANAGER = 0x360E68Faccca8cA495c1B759Fd9EEe466db9FB32;

    function run() external returns (PulseHook hook) {
        address poolManager = vm.envOr("POOL_MANAGER", XLAYER_POOL_MANAGER);
        vm.startBroadcast();
        hook = new PulseHook(poolManager);
        vm.stopBroadcast();
    }
}
