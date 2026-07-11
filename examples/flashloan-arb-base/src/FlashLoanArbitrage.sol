// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IFlashLoanSimpleReceiver, IPool} from "./interfaces/IPool.sol";

/// @title FlashLoanArbitrage
/// @notice Aave V3 flash-loan receiver for multi-hop arbitrage on Base.
/// @dev Owner supplies swap calldata off-chain (Uniswap, Aerodrome, 0x Settler, etc.).
///      Gas for owner txs can be sponsored via CDP Paymaster + Smart Account (ERC-4337).
///      This contract only executes owner-initiated strategies — no permissionless callbacks.
contract FlashLoanArbitrage is IFlashLoanSimpleReceiver {
    error OnlyPool();
    error OnlyOwner();
    error InvalidInitiator();
    error InvalidParams();
    error InsufficientProfit();
    error CallFailed(uint256 index);
    error TransferFailed();

    event ArbitrageExecuted(
        address indexed asset,
        uint256 amount,
        uint256 premium,
        uint256 profit
    );
    event ProfitWithdrawn(address indexed token, address indexed to, uint256 amount);

    /// @notice Encoded into Aave `params` for `executeOperation`.
    struct ArbitrageParams {
        address[] targets;
        bytes[] callDatas;
        uint256 minProfit;
    }

  address public immutable override POOL;
    address public immutable ADDRESSES_PROVIDER;
    address public immutable owner;

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor(address pool, address addressesProvider, address owner_) {
        if (pool == address(0) || owner_ == address(0)) revert InvalidParams();
        POOL = pool;
        ADDRESSES_PROVIDER = addressesProvider;
        owner = owner_;
    }

    /// @notice Borrow `amount` of `asset`, run encoded swaps, repay loan + premium.
    /// @param params ABI-encoded `ArbitrageParams`.
    function executeArbitrage(
        address asset,
        uint256 amount,
        bytes calldata params
    ) external onlyOwner {
        IPool(POOL).flashLoanSimple(address(this), asset, amount, params, 0);
    }

    /// @inheritdoc IFlashLoanSimpleReceiver
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        if (msg.sender != POOL) revert OnlyPool();
        if (initiator != address(this)) revert InvalidInitiator();

        ArbitrageParams memory arb = abi.decode(params, (ArbitrageParams));
        if (arb.targets.length == 0 || arb.targets.length != arb.callDatas.length) {
            revert InvalidParams();
        }

        uint256 len = arb.targets.length;
        for (uint256 i = 0; i < len; i++) {
            (bool ok, bytes memory returndata) = arb.targets[i].call(arb.callDatas[i]);
            if (!ok) {
                if (returndata.length > 0) {
                    assembly {
                        revert(add(returndata, 32), mload(returndata))
                    }
                }
                revert CallFailed(i);
            }
        }

        uint256 owed = amount + premium;
        uint256 balanceAfter = _balance(asset);
        if (balanceAfter < owed + arb.minProfit) revert InsufficientProfit();

        _approve(asset, POOL, owed);

        uint256 profit = balanceAfter - owed;
        emit ArbitrageExecuted(asset, amount, premium, profit);
        return true;
    }

    /// @notice Withdraw ERC-20 profits (or native ETH with token = address(0)).
    function withdraw(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert InvalidParams();
        if (token == address(0)) {
            (bool sent,) = to.call{value: amount}("");
            if (!sent) revert TransferFailed();
        } else {
            _transfer(token, to, amount);
        }
        emit ProfitWithdrawn(token, to, amount);
    }

  receive() external payable {}

    function _balance(address token) internal view returns (uint256) {
        if (token == address(0)) return address(this).balance;
        return _erc20Balance(token, address(this));
    }

    function _approve(address token, address spender, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(0x095ea7b3, spender, amount)
        );
        if (!ok || (data.length > 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _transfer(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(0xa9059cbb, to, amount)
        );
        if (!ok || (data.length > 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _erc20Balance(address token, address account) internal view returns (uint256) {
        (bool ok, bytes memory data) = token.staticcall(
            abi.encodeWithSelector(0x70a08231, account)
        );
        if (!ok || data.length < 32) return 0;
        return abi.decode(data, (uint256));
    }
}
