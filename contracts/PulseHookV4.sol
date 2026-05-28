// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "@uniswap/v4-periphery/src/utils/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";

/// @notice Official Uniswap v4 BaseHook variant of PulseHook.
/// @dev This is the deployment-oriented version. It uses the same scoring and
/// pressure model as the self-contained MVP, but imports canonical v4 types.
contract PulseHookV4 is BaseHook {
    struct PoolTelemetry {
        uint256 lastBlock;
        uint256 emaNotional;
        uint256 pressureBps;
        uint24 currentFeePips;
        uint256 swapCount;
        uint256 lastSwapAt;
        int256 signedFlow;
        bool lastZeroForOne;
    }

    struct ProviderScore {
        uint256 score;
        uint256 firstSeenAt;
        uint256 lastAddedAt;
        uint128 activeLiquidity;
        uint256 earlyExitCount;
    }

    uint24 public constant MIN_FEE_PIPS = 500;
    uint24 public constant BASE_FEE_PIPS = 3_000;
    uint24 public constant MAX_FEE_PIPS = 30_000;
    uint256 public constant EARLY_EXIT_WINDOW = 1 days;

    mapping(PoolId poolId => PoolTelemetry telemetry) public poolTelemetry;
    mapping(PoolId poolId => mapping(address provider => ProviderScore score)) public providerScores;

    event PulseObserved(
        PoolId indexed poolId,
        address indexed sender,
        uint256 notional,
        uint256 pressureBps,
        uint24 feePips
    );
    event LiquidityScored(PoolId indexed poolId, address indexed provider, uint256 liquidityAdded, uint256 newScore);
    event EarlyExitFlagged(PoolId indexed poolId, address indexed provider, uint256 positionAge, uint256 earlyExitCount);

    constructor(IPoolManager manager_) BaseHook(manager_) {}

    function getHookPermissions() public pure override returns (Hooks.Permissions memory permissions) {
        permissions.afterAddLiquidity = true;
        permissions.beforeRemoveLiquidity = true;
        permissions.beforeSwap = true;
        permissions.afterSwap = true;
    }

    function requiredHookAddressMask() external pure returns (uint160) {
        return uint160(
            Hooks.AFTER_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG
                | Hooks.AFTER_SWAP_FLAG
        );
    }

    function previewFee(PoolKey calldata key) external view returns (uint24 feePips, uint24 feeWithOverrideFlag) {
        PoolTelemetry storage telemetry = poolTelemetry[key.toId()];
        feePips = telemetry.currentFeePips == 0 ? BASE_FEE_PIPS : telemetry.currentFeePips;
        feeWithOverrideFlag = feePips | LPFeeLibrary.OVERRIDE_FEE_FLAG;
    }

    function _beforeSwap(address, PoolKey calldata key, SwapParams calldata, bytes calldata)
        internal
        view
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        PoolTelemetry storage telemetry = poolTelemetry[key.toId()];
        uint24 feePips = telemetry.currentFeePips == 0 ? BASE_FEE_PIPS : telemetry.currentFeePips;
        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, feePips | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }

    function _afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta,
        bytes calldata
    ) internal override returns (bytes4, int128) {
        PoolId id = key.toId();
        PoolTelemetry storage telemetry = poolTelemetry[id];
        uint256 notional = _abs(params.amountSpecified);

        uint256 ema = telemetry.emaNotional == 0 ? notional : ((telemetry.emaNotional * 7) + (notional * 3)) / 10;
        int256 direction = params.zeroForOne ? int256(1) : int256(-1);
        int256 signedFlow = ((telemetry.signedFlow * 8) / 10) + (_toInt(notional) * direction);
        uint256 pressure = _pressureBps(telemetry, params.zeroForOne, ema, signedFlow, notional);
        uint24 feePips = _dynamicFeePips(pressure, ema);

        telemetry.lastBlock = block.number;
        telemetry.emaNotional = ema;
        telemetry.pressureBps = pressure;
        telemetry.currentFeePips = feePips;
        telemetry.swapCount += 1;
        telemetry.lastSwapAt = block.timestamp;
        telemetry.signedFlow = signedFlow;
        telemetry.lastZeroForOne = params.zeroForOne;

        emit PulseObserved(id, sender, notional, pressure, feePips);

        return (BaseHook.afterSwap.selector, 0);
    }

    function _afterAddLiquidity(
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) internal override returns (bytes4, BalanceDelta) {
        if (params.liquidityDelta <= 0) {
            return (BaseHook.afterAddLiquidity.selector, BalanceDeltaLibrary.ZERO_DELTA);
        }

        PoolId id = key.toId();
        PoolTelemetry storage telemetry = poolTelemetry[id];
        ProviderScore storage provider = providerScores[id][sender];
        uint256 liquidity = uint256(params.liquidityDelta);

        if (provider.firstSeenAt == 0) provider.firstSeenAt = block.timestamp;
        provider.lastAddedAt = block.timestamp;
        provider.activeLiquidity = _saturatingAdd(provider.activeLiquidity, liquidity);
        provider.score += _liquidityScore(liquidity, telemetry.pressureBps);

        emit LiquidityScored(id, sender, liquidity, provider.score);

        return (BaseHook.afterAddLiquidity.selector, BalanceDeltaLibrary.ZERO_DELTA);
    }

    function _beforeRemoveLiquidity(
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        bytes calldata
    ) internal override returns (bytes4) {
        if (params.liquidityDelta >= 0) return BaseHook.beforeRemoveLiquidity.selector;

        PoolId id = key.toId();
        ProviderScore storage provider = providerScores[id][sender];
        uint256 age = provider.lastAddedAt == 0 ? type(uint256).max : block.timestamp - provider.lastAddedAt;

        if (age < EARLY_EXIT_WINDOW && provider.activeLiquidity > 0) {
            provider.earlyExitCount += 1;
            emit EarlyExitFlagged(id, sender, age, provider.earlyExitCount);
        }

        return BaseHook.beforeRemoveLiquidity.selector;
    }

    function getPoolTelemetry(PoolKey calldata key) external view returns (PoolTelemetry memory) {
        PoolTelemetry memory telemetry = poolTelemetry[key.toId()];
        if (telemetry.currentFeePips == 0) telemetry.currentFeePips = BASE_FEE_PIPS;
        return telemetry;
    }

    function getProviderScore(PoolKey calldata key, address provider) external view returns (ProviderScore memory) {
        return providerScores[key.toId()][provider];
    }

    function _dynamicFeePips(uint256 pressureBps, uint256 emaNotional) internal pure returns (uint24) {
        uint256 pressure = pressureBps > 10_000 ? 10_000 : pressureBps;
        uint256 activitySurcharge = emaNotional > 1_000_000 ether ? 4_000 : emaNotional > 100_000 ether ? 1_500 : 0;
        uint256 fee = BASE_FEE_PIPS + ((pressure * 28) / 10) + activitySurcharge;
        if (fee < MIN_FEE_PIPS) return MIN_FEE_PIPS;
        if (fee > MAX_FEE_PIPS) return MAX_FEE_PIPS;
        return uint24(fee);
    }

    function _pressureBps(
        PoolTelemetry storage telemetry,
        bool zeroForOne,
        uint256 ema,
        int256 signedFlow,
        uint256 notional
    ) internal view returns (uint256) {
        if (ema == 0) return 0;

        uint256 basePressure = (_abs(signedFlow) * 10_000) / ((ema * 8) + 1);
        uint256 flipPremium = telemetry.swapCount > 0 && telemetry.lastZeroForOne != zeroForOne ? 1_800 : 0;
        uint256 spikePremium = telemetry.emaNotional > 0 && notional > telemetry.emaNotional * 2 ? 1_200 : 0;
        uint256 pressure = basePressure + flipPremium + spikePremium;

        return pressure > 10_000 ? 10_000 : pressure;
    }

    function _liquidityScore(uint256 liquidity, uint256 pressureBps) internal pure returns (uint256) {
        uint256 discount = pressureBps > 8_000 ? 4_000 : pressureBps / 2;
        return (liquidity * (10_000 - discount)) / 10_000;
    }

    function _abs(int256 value) internal pure returns (uint256) {
        if (value >= 0) return uint256(value);
        if (value == type(int256).min) return uint256(type(int256).max) + 1;
        return uint256(-value);
    }

    function _toInt(uint256 value) internal pure returns (int256) {
        return value > uint256(type(int256).max) ? type(int256).max : int256(value);
    }

    function _saturatingAdd(uint128 current, uint256 added) internal pure returns (uint128) {
        if (added > type(uint128).max - current) return type(uint128).max;
        return current + uint128(added);
    }
}
