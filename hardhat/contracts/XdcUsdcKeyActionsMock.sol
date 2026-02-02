// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

/**
 * This contract is intentionally "event rich".
 *
 * We will inject its runtime bytecode into an existing address on a forked chain
 * (via `hardhat_setCode`) so OpenZeppelin Monitor can observe events coming from
 * that exact address without needing any privileges on the real mainnet contract.
 */
contract XdcUsdcKeyActionsMock {
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Mint(address indexed minter, address indexed to, uint256 amount);
    event Pause();
    event Paused(address indexed account);
    event Upgraded(address implementation);

    function demoEmit() external payable {
        emit Transfer(msg.sender, address(0x000000000000000000000000000000000000bEEF), 1);
        emit Mint(msg.sender, address(0x000000000000000000000000000000000000cafE), 2);
        emit Pause();
        emit Paused(msg.sender);
        emit Upgraded(address(0x0000000000000000000000000000000000001234));
    }

    // Matches monitor's function signatures
    function upgradeTo(address newImplementation) external {
        emit Upgraded(newImplementation);
    }

    // Matches monitor's function signatures
    function upgradeToAndCall(address newImplementation, bytes calldata /*data*/ ) external payable {
        emit Upgraded(newImplementation);
    }

    // Optional helpers (not required by monitor config)
    function mint(address to, uint256 amount) external {
        emit Mint(msg.sender, to, amount);
    }

    function transfer(address to, uint256 value) external {
        emit Transfer(msg.sender, to, value);
    }

    function pause() external {
        emit Pause();
        emit Paused(msg.sender);
    }
}


