// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal Aave V3 Pool surface for flashLoanSimple flows on Base.
interface IPool {
    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 referralCode
    ) external;
}

/// @notice Callback invoked by Aave V3 Pool during flashLoanSimple.
interface IFlashLoanSimpleReceiver {
    function ADDRESSES_PROVIDER() external view returns (address);

    function POOL() external view returns (address);

    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool);
}
