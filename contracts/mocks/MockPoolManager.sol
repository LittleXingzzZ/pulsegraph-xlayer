// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PulseHook} from "../PulseHook.sol";

contract MockPoolManager {
    PulseHook public immutable hook;
    PulseHook.PoolKey public key;

    constructor(PulseHook hook_, PulseHook.PoolKey memory key_) {
        hook = hook_;
        key = key_;
    }

    function seed() external {
        hook.seedPool(key);
    }

    function swap(bool zeroForOne, int256 amountSpecified) external {
        PulseHook.SwapParams memory params = PulseHook.SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: amountSpecified,
            sqrtPriceLimitX96: 0
        });

        hook.beforeSwap(msg.sender, key, params, "");
        hook.afterSwap(msg.sender, key, params, PulseHook.BalanceDelta.wrap(0), "");
    }

    function addLiquidity(int256 liquidityDelta) external {
        PulseHook.ModifyLiquidityParams memory params = PulseHook.ModifyLiquidityParams({
            tickLower: -60,
            tickUpper: 60,
            liquidityDelta: liquidityDelta,
            salt: bytes32(0)
        });

        hook.afterAddLiquidity(
            msg.sender,
            key,
            params,
            PulseHook.BalanceDelta.wrap(0),
            PulseHook.BalanceDelta.wrap(0),
            ""
        );
    }

    function removeLiquidity(int256 liquidityDelta) external {
        PulseHook.ModifyLiquidityParams memory params = PulseHook.ModifyLiquidityParams({
            tickLower: -60,
            tickUpper: 60,
            liquidityDelta: liquidityDelta,
            salt: bytes32(0)
        });

        hook.beforeRemoveLiquidity(msg.sender, key, params, "");
    }
}
