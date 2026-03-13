/**
 * Demo: 权限变更事件测试
 * 
 * 触发 RoleGranted 和 RoleRevoked 事件
 * 
 * 使用方法:
 *   npm run demo:emit:grant
 *   npm run demo:emit:revoke
 */

const hre = require("hardhat");
const path = require("path");
const { getProvider, getNetworkName, resetFork, impersonateAccount, stopImpersonating } = require("./network");

require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
require("dotenv").config({ path: path.resolve(__dirname, "../../config/influxdb.env") });

const USDC_ADDRESS = "0xfa2958cb79b0491cc627c1557f441ef849ca8eb1";

// OpenZeppelin 角色哈希
const ROLES = {
  MINTER_ROLE: "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6",
  PAUSER_ROLE: "0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a",
};

// 测试地址 - 随机生成
const TEST_ADDRESS = "0x" + Math.random().toString(16).slice(2).padStart(40, "0");

// AccessControl grant/revoke role functions
const ACCESS_CONTROL_ABI = [
  {
    type: "function",
    name: "grantRole",
    stateMutability: "nonpayable",
    inputs: [
      { name: "role", type: "bytes32" },
      { name: "account", type: "address" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "revokeRole",
    stateMutability: "nonpayable",
    inputs: [
      { name: "role", type: "bytes32" },
      { name: "account", type: "address" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "hasRole",
    stateMutability: "view",
    inputs: [
      { name: "role", type: "bytes32" },
      { name: "account", type: "address" }
    ],
    outputs: [{ name: "", type: "bool" }]
  }
];

/**
 * Grant Role Demo
 */
async function grantRoleDemo() {
  console.log("\n" + "=".repeat(60));
  console.log("🔐 Demo: Grant Role (RoleGranted Event)");
  console.log("=".repeat(60));

  const networkName = getNetworkName();
  console.log(`📡 Network: ${networkName}`);
  console.log(`💰 USDC Contract: ${USDC_ADDRESS}`);
  console.log(`🎭 Grant MINTER_ROLE to: ${TEST_ADDRESS}`);
  console.log("=".repeat(60) + "\n");

  try {
    const provider = getProvider();
    
    // 获取当前区块号
    const blockBefore = await provider.getBlockNumber();
    console.log(`📦 Block before: ${blockBefore}`);

    // 获取 admin 账户来执行 grantRole (需要 DEFAULT_ADMIN_ROLE)
    // 在测试环境中，我们使用 hardhat_impersonateAccount 来模拟
    const adminAddress = "0xa4ba017d08b1f030b83a5947615a5a8a5a26be2e"; // 替换为实际的 admin 地址
    
    // 尝试 impersonate admin 账户
    try {
      await impersonateAccount(adminAddress);
    } catch (e) {
      console.log("⚠️  Could not impersonate, trying direct call...");
    }

    // 连接到合约
    const signer = await provider.getSigner(adminAddress);
    const usdc = new hre.ethers.Contract(USDC_ADDRESS, ACCESS_CONTROL_ABI, signer);

    // 检查当前角色状态
    const hasRoleBefore = await usdc.hasRole(ROLES.MINTER_ROLE, TEST_ADDRESS);
    console.log(`\n📋 Before: hasRole(MINTER_ROLE, ${TEST_ADDRESS.slice(0, 10)}...) = ${hasRoleBefore}`);

    // 授予角色
    console.log(`\n⏳ Granting MINTER_ROLE to ${TEST_ADDRESS.slice(0, 10)}...`);
    const tx = await usdc.grantRole(ROLES.MINTER_ROLE, TEST_ADDRESS);
    const receipt = await tx.wait();
    
    console.log(`✅ Transaction confirmed!`);
    console.log(`   Hash: ${receipt.transactionHash}`);
    console.log(`   Block: ${receipt.blockNumber}`);
    console.log(`   Gas used: ${receipt.gasUsed.toString()}`);

    // 检查事件
    const roleGrantedEvent = receipt.logs.find(log => {
      try {
        const parsed = usdc.interface.parseLog(log);
        return parsed && parsed.name === "RoleGranted";
      } catch {
        return false;
      }
    });

    if (roleGrantedEvent) {
      console.log(`\n🎉 RoleGranted Event emitted!`);
      const parsed = usdc.interface.parseLog(roleGrantedEvent);
      console.log(`   Role: ${parsed.args.role}`);
      console.log(`   Account: ${parsed.args.account}`);
      console.log(`   Sender: ${parsed.args.sender}`);
    }

    // 验证角色已授予
    const hasRoleAfter = await usdc.hasRole(ROLES.MINTER_ROLE, TEST_ADDRESS);
    console.log(`\n📋 After: hasRole(MINTER_ROLE, ${TEST_ADDRESS.slice(0, 10)}...) = ${hasRoleAfter}`);

    await stopImpersonating(adminAddress);
    
    console.log("\n✅ Demo completed! RoleGranted event should be captured by monitor.");
    
  } catch (error) {
    console.error("\n❌ Error:", error.message);
    if (error.message.includes("hardfork")) {
      console.log("\n⚠️  Hardfork error - trying with latest block tag...");
    }
  }
}

/**
 * Revoke Role Demo
 */
async function revokeRoleDemo() {
  console.log("\n" + "=".repeat(60));
  console.log("🔐 Demo: Revoke Role (RoleRevoked Event)");
  console.log("=".repeat(60));

  const networkName = getNetworkName();
  console.log(`📡 Network: ${networkName}`);
  console.log(`💰 USDC Contract: ${USDC_ADDRESS}`);
  console.log(`🎭 Revoke MINTER_ROLE from: ${TEST_ADDRESS}`);
  console.log("=".repeat(60) + "\n");

  try {
    const provider = getProvider();
    
    // 获取当前区块号
    const blockBefore = await provider.getBlockNumber();
    console.log(`📦 Block before: ${blockBefore}`);

    const adminAddress = "0xa4ba017d08b1f030b83a5947615a5a8a5a26be2e";
    
    // 尝试 impersonate admin 账户
    try {
      await impersonateAccount(adminAddress);
    } catch (e) {
      console.log("⚠️  Could not impersonate, trying direct call...");
    }

    const signer = await provider.getSigner(adminAddress);
    const usdc = new hre.ethers.Contract(USDC_ADDRESS, ACCESS_CONTROL_ABI, signer);

    // 检查当前角色状态
    const hasRoleBefore = await usdc.hasRole(ROLES.MINTER_ROLE, TEST_ADDRESS);
    console.log(`\n📋 Before: hasRole(MINTER_ROLE, ${TEST_ADDRESS.slice(0, 10)}...) = ${hasRoleBefore}`);

    if (!hasRoleBefore) {
      console.log(`\n⚠️  Address doesn't have MINTER_ROLE, granting first...`);
      await usdc.grantRole(ROLES.MINTER_ROLE, TEST_ADDRESS);
      console.log(`✅ Role granted`);
    }

    // 撤销角色
    console.log(`\n⏳ Revoking MINTER_ROLE from ${TEST_ADDRESS.slice(0, 10)}...`);
    const tx = await usdc.revokeRole(ROLES.MINTER_ROLE, TEST_ADDRESS);
    const receipt = await tx.wait();
    
    console.log(`✅ Transaction confirmed!`);
    console.log(`   Hash: ${receipt.transactionHash}`);
    console.log(`   Block: ${receipt.blockNumber}`);
    console.log(`   Gas used: ${receipt.gasUsed.toString()}`);

    // 检查事件
    const roleRevokedEvent = receipt.logs.find(log => {
      try {
        const parsed = usdc.interface.parseLog(log);
        return parsed && parsed.name === "RoleRevoked";
      } catch {
        return false;
      }
    });

    if (roleRevokedEvent) {
      console.log(`\n🎉 RoleRevoked Event emitted!`);
      const parsed = usdc.interface.parseLog(roleRevokedEvent);
      console.log(`   Role: ${parsed.args.role}`);
      console.log(`   Account: ${parsed.args.account}`);
      console.log(`   Sender: ${parsed.args.sender}`);
    }

    // 验证角色已撤销
    const hasRoleAfter = await usdc.hasRole(ROLES.MINTER_ROLE, TEST_ADDRESS);
    console.log(`\n📋 After: hasRole(MINTER_ROLE, ${TEST_ADDRESS.slice(0, 10)}...) = ${hasRoleAfter}`);

    await stopImpersonating(adminAddress);
    
    console.log("\n✅ Demo completed! RoleRevoked event should be captured by monitor.");
    
  } catch (error) {
    console.error("\n❌ Error:", error.message);
  }
}

// Main
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === "revoke") {
    await revokeRoleDemo();
  } else {
    await grantRoleDemo();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

