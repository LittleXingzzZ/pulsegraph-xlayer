// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

import {PulseHookDemoToken} from "./PulseHookDemoToken.sol";

/// @notice Permissionless variant of PulseHookDemoExecutor for the live demo UI.
/// Any caller may invoke initializePool / addLiquidity / swapExactInput; the
/// executor self-funds from its own token balance so callers only pay gas.
/// Safe because: tokens never leave the executor — swap returns the other side
/// to the same address, and added liquidity is owned by the executor.
contract PulseHookDemoExecutorPublic is IUnlockCallback {
    using BalanceDeltaLibrary for BalanceDelta;

    enum CallbackAction {
        AddLiquidity,
        Swap
    }

    struct CallbackData {
        CallbackAction action;
        ModifyLiquidityParams liquidityParams;
        SwapParams swapParams;
        bytes hookData;
    }

    IPoolManager public immutable manager;
    PulseHookDemoToken public immutable tokenA;
    PulseHookDemoToken public immutable tokenB;
    PoolKey public key;
    bool public poolInitialized;

    uint24 public constant DYNAMIC_FEE = LPFeeLibrary.DYNAMIC_FEE_FLAG;
    int24 public constant TICK_SPACING = 60;
    int24 public constant TICK_LOWER = -600;
    int24 public constant TICK_UPPER = 600;
    uint160 public constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    // Anti-grief caps: a single permissionless call cannot drain or distort
    // the pool beyond these magnitudes. Reasonable for demo traffic.
    uint128 public constant MAX_SWAP_AMOUNT = 5e21;       // 5,000 tokens (18 decimals)
    uint128 public constant MAX_LIQUIDITY_DELTA = 1e22;   // 10,000 LP units

    event DemoPoolInitialized(bytes32 indexed poolId, address indexed hook, address currency0, address currency1);
    event DemoLiquidityAdded(bytes32 indexed poolId, address indexed caller, int256 liquidityDelta, int128 amount0, int128 amount1);
    event DemoSwap(bytes32 indexed poolId, address indexed caller, bool zeroForOne, int256 amountSpecified, int128 amount0, int128 amount1);

    constructor(IPoolManager manager_, IHooks hook_, uint256 tokenSupply_) {
        manager = manager_;
        tokenA = new PulseHookDemoToken("PulseHook Public Alpha", "pPHA", tokenSupply_, address(this));
        tokenB = new PulseHookDemoToken("PulseHook Public Beta", "pPHB", tokenSupply_, address(this));

        (address currency0, address currency1) =
            address(tokenA) < address(tokenB) ? (address(tokenA), address(tokenB)) : (address(tokenB), address(tokenA));

        key = PoolKey({
            currency0: Currency.wrap(currency0),
            currency1: Currency.wrap(currency1),
            fee: DYNAMIC_FEE,
            tickSpacing: TICK_SPACING,
            hooks: hook_
        });
    }

    function initializePool() external returns (int24 tick) {
        if (poolInitialized) revert AlreadyInitialized();
        poolInitialized = true;
        tick = manager.initialize(key, SQRT_PRICE_1_1);
        emit DemoPoolInitialized(_poolId(), address(key.hooks), Currency.unwrap(key.currency0), Currency.unwrap(key.currency1));
    }

    function addLiquidity(uint128 liquidity) external returns (BalanceDelta delta) {
        if (liquidity == 0) revert ZeroAmount();
        if (liquidity > MAX_LIQUIDITY_DELTA) revert AmountExceedsCap();

        ModifyLiquidityParams memory params = ModifyLiquidityParams({
            tickLower: TICK_LOWER,
            tickUpper: TICK_UPPER,
            liquidityDelta: int256(uint256(liquidity)),
            salt: bytes32(0)
        });

        delta = abi.decode(
            manager.unlock(abi.encode(CallbackData(CallbackAction.AddLiquidity, params, _emptySwap(), bytes("")))),
            (BalanceDelta)
        );
        emit DemoLiquidityAdded(_poolId(), msg.sender, params.liquidityDelta, delta.amount0(), delta.amount1());
    }

    function swapExactInput(bool zeroForOne, uint128 amountIn) external returns (BalanceDelta delta) {
        if (amountIn == 0) revert ZeroAmount();
        if (amountIn > MAX_SWAP_AMOUNT) revert AmountExceedsCap();

        SwapParams memory params = SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: -int256(uint256(amountIn)),
            sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        });

        delta = abi.decode(
            manager.unlock(
                abi.encode(
                    CallbackData(
                        CallbackAction.Swap,
                        ModifyLiquidityParams({tickLower: 0, tickUpper: 0, liquidityDelta: 0, salt: bytes32(0)}),
                        params,
                        bytes("")
                    )
                )
            ),
            (BalanceDelta)
        );
        emit DemoSwap(_poolId(), msg.sender, zeroForOne, params.amountSpecified, delta.amount0(), delta.amount1());
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(manager)) revert OnlyPoolManager();
        CallbackData memory callback = abi.decode(data, (CallbackData));

        BalanceDelta delta;
        if (callback.action == CallbackAction.AddLiquidity) {
            (delta,) = manager.modifyLiquidity(key, callback.liquidityParams, callback.hookData);
        } else if (callback.action == CallbackAction.Swap) {
            delta = manager.swap(key, callback.swapParams, callback.hookData);
        } else {
            revert UnsupportedAction();
        }

        _settleDelta(delta);
        return abi.encode(delta);
    }

    function poolKey() external view returns (PoolKey memory) {
        return key;
    }

    function _settleDelta(BalanceDelta delta) internal {
        int128 amount0 = delta.amount0();
        int128 amount1 = delta.amount1();

        if (amount0 < 0) _settle(key.currency0, uint128(-amount0));
        if (amount1 < 0) _settle(key.currency1, uint128(-amount1));
        if (amount0 > 0) manager.take(key.currency0, address(this), uint128(amount0));
        if (amount1 > 0) manager.take(key.currency1, address(this), uint128(amount1));
    }

    function _settle(Currency currency, uint256 amount) internal {
        if (amount == 0) return;
        manager.sync(currency);
        PulseHookDemoToken(Currency.unwrap(currency)).transfer(address(manager), amount);
        manager.settle();
    }

    function _poolId() internal view returns (bytes32) {
        return keccak256(abi.encode(key));
    }

    function _emptySwap() internal pure returns (SwapParams memory) {
        return SwapParams({zeroForOne: false, amountSpecified: 0, sqrtPriceLimitX96: 0});
    }

    error OnlyPoolManager();
    error UnsupportedAction();
    error AlreadyInitialized();
    error ZeroAmount();
    error AmountExceedsCap();
}
