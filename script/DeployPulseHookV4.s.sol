// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PulseHookV4} from "../contracts/PulseHookV4.sol";

contract DeployPulseHookV4 is Script {
    address internal constant XLAYER_POOL_MANAGER = 0x360E68Faccca8cA495c1B759Fd9EEe466db9FB32;

    function run() external returns (PulseHookV4 hook) {
        address poolManager = vm.envOr("POOL_MANAGER", XLAYER_POOL_MANAGER);
        bytes32 salt = vm.envOr("HOOK_SALT", bytes32(uint256(0x4328)));

        vm.startBroadcast();
        hook = new PulseHookV4{salt: salt}(IPoolManager(poolManager));
        vm.stopBroadcast();
    }
}
