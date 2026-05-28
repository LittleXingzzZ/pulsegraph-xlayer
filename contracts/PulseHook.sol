// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Self-contained Uniswap v4-style primitives used so the hackathon MVP
/// can be read and audited without fetching dependencies. Replace these structs
/// with the official v4-core imports before production deployment.
contract PulseHook {
    type BeforeSwapDelta is int256;
    type BalanceDelta is int256;

    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    struct SwapParams {
        bool zeroForOne;
        int256 amountSpecified;
        uint160 sqrtPriceLimitX96;
    }

    struct ModifyLiquidityParams {
        int24 tickLower;
        int24 tickUpper;
        int256 liquidityDelta;
        bytes32 salt;
    }

    struct HookPermissions {
        bool beforeInitialize;
        bool afterInitialize;
        bool beforeAddLiquidity;
        bool afterAddLiquidity;
        bool beforeRemoveLiquidity;
        bool afterRemoveLiquidity;
        bool beforeSwap;
        bool afterSwap;
        bool beforeDonate;
        bool afterDonate;
        bool beforeSwapReturnDelta;
        bool afterSwapReturnDelta;
        bool afterAddLiquidityReturnDelta;
        bool afterRemoveLiquidityReturnDelta;
    }

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
    uint24 public constant OVERRIDE_FEE_FLAG = 0x400000;
    uint256 public constant EARLY_EXIT_WINDOW = 1 days;

    uint160 public constant BEFORE_ADD_LIQUIDITY_FLAG = 1 << 11;
    uint160 public constant AFTER_ADD_LIQUIDITY_FLAG = 1 << 10;
    uint160 public constant BEFORE_REMOVE_LIQUIDITY_FLAG = 1 << 9;
    uint160 public constant BEFORE_SWAP_FLAG = 1 << 7;
    uint160 public constant AFTER_SWAP_FLAG = 1 << 6;

    address public immutable poolManager;
    address public immutable owner;

    mapping(bytes32 poolId => PoolTelemetry telemetry) public poolTelemetry;
    mapping(bytes32 poolId => mapping(address provider => ProviderScore score)) public providerScores;

    event PulseObserved(
        bytes32 indexed poolId,
        address indexed sender,
        uint256 notional,
        uint256 pressureBps,
        uint24 feePips
    );
    event LiquidityScored(
        bytes32 indexed poolId,
        address indexed provider,
        uint256 liquidityAdded,
        uint256 newScore
    );
    event EarlyExitFlagged(
        bytes32 indexed poolId,
        address indexed provider,
        uint256 positionAge,
        uint256 earlyExitCount
    );
    event PoolConfigured(bytes32 indexed poolId, address currency0, address currency1, uint24 baseFeePips);

    error OnlyPoolManager();
    error InvalidPoolManager();

    modifier onlyPoolManager() {
        if (msg.sender != poolManager) revert OnlyPoolManager();
        _;
    }

    constructor(address poolManager_) {
        if (poolManager_ == address(0)) revert InvalidPoolManager();
        poolManager = poolManager_;
        owner = msg.sender;
    }

    function getHookPermissions() external pure returns (HookPermissions memory permissions) {
        permissions.afterAddLiquidity = true;
        permissions.beforeRemoveLiquidity = true;
        permissions.beforeSwap = true;
        permissions.afterSwap = true;
    }

    function requiredHookAddressMask() external pure returns (uint160) {
        return AFTER_ADD_LIQUIDITY_FLAG | BEFORE_REMOVE_LIQUIDITY_FLAG | BEFORE_SWAP_FLAG | AFTER_SWAP_FLAG;
    }

    function poolId(PoolKey calldata key) public pure returns (bytes32) {
        return keccak256(abi.encode(key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks));
    }

    function previewFee(PoolKey calldata key) external view returns (uint24 feePips, uint24 feeWithOverrideFlag) {
        PoolTelemetry storage telemetry = poolTelemetry[poolId(key)];
        feePips = telemetry.currentFeePips == 0 ? BASE_FEE_PIPS : telemetry.currentFeePips;
        feeWithOverrideFlag = feePips | OVERRIDE_FEE_FLAG;
    }

    function beforeSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata,
        bytes calldata
    ) external view onlyPoolManager returns (bytes4, BeforeSwapDelta, uint24) {
        PoolTelemetry storage telemetry = poolTelemetry[poolId(key)];
        uint24 feePips = telemetry.currentFeePips == 0 ? BASE_FEE_PIPS : telemetry.currentFeePips;
        return (PulseHook.beforeSwap.selector, BeforeSwapDelta.wrap(0), feePips | OVERRIDE_FEE_FLAG);
    }

    function afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta,
        bytes calldata
    ) external onlyPoolManager returns (bytes4, int128) {
        bytes32 id = poolId(key);
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

        return (PulseHook.afterSwap.selector, 0);
    }

    function afterAddLiquidity(
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external onlyPoolManager returns (bytes4, BalanceDelta) {
        if (params.liquidityDelta <= 0) {
            return (PulseHook.afterAddLiquidity.selector, BalanceDelta.wrap(0));
        }

        bytes32 id = poolId(key);
        PoolTelemetry storage telemetry = poolTelemetry[id];
        ProviderScore storage provider = providerScores[id][sender];
        uint256 liquidity = uint256(params.liquidityDelta);

        if (provider.firstSeenAt == 0) provider.firstSeenAt = block.timestamp;
        provider.lastAddedAt = block.timestamp;
        provider.activeLiquidity = _saturatingAdd(provider.activeLiquidity, liquidity);
        provider.score += _liquidityScore(liquidity, telemetry.pressureBps);

        emit LiquidityScored(id, sender, liquidity, provider.score);

        return (PulseHook.afterAddLiquidity.selector, BalanceDelta.wrap(0));
    }

    function beforeRemoveLiquidity(
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        bytes calldata
    ) external onlyPoolManager returns (bytes4) {
        if (params.liquidityDelta >= 0) return PulseHook.beforeRemoveLiquidity.selector;

        bytes32 id = poolId(key);
        ProviderScore storage provider = providerScores[id][sender];
        uint256 age = provider.lastAddedAt == 0 ? type(uint256).max : block.timestamp - provider.lastAddedAt;

        if (age < EARLY_EXIT_WINDOW && provider.activeLiquidity > 0) {
            provider.earlyExitCount += 1;
            emit EarlyExitFlagged(id, sender, age, provider.earlyExitCount);
        }

        return PulseHook.beforeRemoveLiquidity.selector;
    }

    function seedPool(PoolKey calldata key) external onlyPoolManager {
        bytes32 id = poolId(key);
        PoolTelemetry storage telemetry = poolTelemetry[id];
        if (telemetry.currentFeePips == 0) {
            telemetry.currentFeePips = BASE_FEE_PIPS;
            emit PoolConfigured(id, key.currency0, key.currency1, BASE_FEE_PIPS);
        }
    }

    function getPoolTelemetry(PoolKey calldata key) external view returns (PoolTelemetry memory) {
        PoolTelemetry memory telemetry = poolTelemetry[poolId(key)];
        if (telemetry.currentFeePips == 0) telemetry.currentFeePips = BASE_FEE_PIPS;
        return telemetry;
    }

    function getProviderScore(PoolKey calldata key, address provider) external view returns (ProviderScore memory) {
        return providerScores[poolId(key)][provider];
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
