/**
 * Permissions 轮询脚本
 * 
 * 定时查询 USDC 合约的权限状态并写入 InfluxDB
 * 用于 Permission Matrix 的可视化数据源
 * 
 * 使用方法:
 *   # 本地测试网络 (Hardhat fork)
 *   npm run poll:permissions
 * 
 *   # XDC 主网
 *   npm run poll:permissions:remote
 * 
 *   # 自定义轮询间隔
 *   POLL_INTERVAL_MS=30000 npm run poll:permissions
 * 
 * 环境变量:
 *   INFLUXDB_URL      - InfluxDB 地址
 *   INFLUXDB_TOKEN   - InfluxDB token
 *   INFLUXDB_BUCKET  - bucket 名称
 *   INFLUXDB_ORG     - org 名称
 *   POLL_INTERVAL    - 轮询间隔毫秒
 *   XDC_RPC_URL      - XDC RPC 地址
 */

const hre = require("hardhat");
const path = require("path");
const { getProvider, getNetworkName } = require("./network");

require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
require("dotenv").config({ path: path.resolve(__dirname, "../../config/influxdb.env") });

const USDC_ADDRESS = "0xfa2958cb79b0491cc627c1557f441ef849ca8eb1";

const INFLUX_URL = process.env.INFLUXDB_URL || "http://149.102.157.42:8086";
const INFLUX_TOKEN = process.env.INFLUXDB_TOKEN;
const INFLUX_BUCKET = process.env.INFLUXDB_BUCKET || "usdc_testdata_bucket";
const INFLUX_ORG = process.env.INFLUXDB_ORG || "xdc";
const NETWORK_SLUG = process.env.NETWORK_SLUG || "xdc_mainnet_fork_local";

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "60000", 10);

// OpenZeppelin AccessControl 角色哈希
const ROLES = {
  DEFAULT_ADMIN_ROLE: "0x0000000000000000000000000000000000000000000000000000000000000000",
  MINTER_ROLE: "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6", // keccak256("MINTER_ROLE")
  PAUSER_ROLE: "0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a", // keccak256("PAUSER_ROLE")
  MASTER_MINTER_ROLE: "0xef4c4c3b94ff2a06f31edb9e7c4e2b3c5a3c8e7f4b6d3c5e6f7a8b9c0d1e2f3", // custom
};

// 要检查的地址列表 (这些是 XDC USDC 已知的管理角色地址)
// 生产环境可能需要从配置文件或数据库读取
const CHECK_ADDRESSES = [
  "0x0000000000000000000000000000000000000001", // null address
  "0xa4ba017d08b1f030b83a5947615a5a8a5a26be2e", // admin address 1
  "0x7c68c42De38c1f65dC86fB8b0E46Fa7bFc12c2a", // admin address 2  
  "0x8f5781b2e7b2e7d4e4b5e6d7c8a9b0c1d2e3f4a", // example minter
];

// 角色名称映射 (用于显示)
const ROLE_NAMES = {
  "0x0000000000000000000000000000000000000000000000000000000000000000": "DEFAULT_ADMIN_ROLE",
  "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6": "MINTER_ROLE",
  "0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a": "PAUSER_ROLE",
};

// AccessControl ABI - hasRole function
const ACCESS_CONTROL_ABI = [
  {
    type: "function",
    name: "hasRole",
    stateMutability: "view",
    inputs: [
      { name: "role", type: "bytes32" },
      { name: "account", type: "address" }
    ],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    type: "function",
    name: "getRoleAdmin",
    stateMutability: "view",
    inputs: [{ name: "role", type: "bytes32" }],
    outputs: [{ name: "", type: "bytes32" }]
  },
  {
    type: "function",
    name: "getRoleMember",
    stateMutability: "view",
    inputs: [
      { name: "role", type: "bytes32" },
      { name: "index", type: "uint256" }
    ],
    outputs: [{ name: "", type: "address" }]
  },
  {
    type: "function",
    name: "getRoleMemberCount",
    stateMutability: "view",
    inputs: [{ name: "role", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }]
  }
];

/**
 * 写入数据到 InfluxDB v2
 */
async function writeToInfluxDB(lineProtocol) {
  if (!INFLUX_TOKEN) {
    console.log("⚠️  INFLUXDB_TOKEN not set, skipping InfluxDB write");
    return false;
  }

  try {
    const response = await fetch(
      `${INFLUX_URL}/api/v2/write?org=${INFLUX_ORG}&bucket=${INFLUX_BUCKET}&precision=ns`,
      {
        method: "POST",
        headers: {
          "Authorization": `Token ${INFLUX_TOKEN}`,
          "Content-Type": "text/plain; charset=utf-8"
        },
        body: lineProtocol
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`InfluxDB error ${response.status}: ${errorText}`);
    }

    return true;
  } catch (error) {
    console.error("❌ Failed to write to InfluxDB:", error.message);
    return false;
  }
}

/**
 * 查询指定角色的所有成员地址
 */
async function getRoleMembers(contract, role) {
  const members = [];
  try {
    const count = await contract.getRoleMemberCount(role);
    const countNum = Number(count);
    
    for (let i = 0; i < countNum; i++) {
      try {
        const member = await contract.getRoleMember(role, i);
        if (member && member !== "0x0000000000000000000000000000000000000000") {
          members.push(member);
        }
      } catch (e) {
        // 忽略索引越界错误
        break;
      }
    }
  } catch (error) {
    // 合约可能没有实现这个接口
    console.log(`   ⚠️  getRoleMemberCount failed for role: ${role.slice(0, 10)}...`);
  }
  return members;
}

/**
 * 轮询权限状态并写入 InfluxDB
 */
async function pollPermissions() {
  const timestamp = Date.now() * 1_000_000;
  
  try {
    const provider = getProvider();
    const block = await provider.getBlockNumber();
    const contract = new hre.ethers.Contract(USDC_ADDRESS, ACCESS_CONTROL_ABI, provider);
    
    console.log(`\n[${new Date().toISOString()}] 🔐 Checking permissions (block: ${block})`);
    
    let totalWrites = 0;
    const allPermissions = [];
    
    // 查询每个角色
    for (const [roleName, roleHash] of Object.entries(ROLES)) {
      // 获取该角色的所有成员
      const members = await getRoleMembers(contract, roleHash);
      
      if (members.length > 0) {
        console.log(`   ${roleName}: ${members.length} member(s)`);
        
        for (const member of members) {
          const shortAddr = member.slice(0, 6) + "..." + member.slice(-4);
          
          // 写入 InfluxDB - 每个地址一行
          // measurement: permissions
          // tags: network_slug, role, address
          // fields: has_role (always 1 for current holders)
          const lineProtocol = `permissions,network_slug=${NETWORK_SLUG},role=${roleName},address=${member} has_role=1i,block_number=${block}i ${timestamp}`;
          
          const success = await writeToInfluxDB(lineProtocol);
          if (success) totalWrites++;
          
          allPermissions.push({
            role: roleName,
            address: member,
            shortAddress: shortAddr
          });
        }
      }
    }
    
    // 同时检查预设地址列表中的权限状态
    console.log(`\n   📋 Checking configured addresses...`);
    for (const addr of CHECK_ADDRESSES) {
      for (const [roleName, roleHash] of Object.entries(ROLES)) {
        try {
          const hasRole = await contract.hasRole(roleHash, addr);
          if (hasRole) {
            const shortAddr = addr.slice(0, 6) + "..." + addr.slice(-4);
            console.log(`   ${shortAddr} has ${roleName}`);
            
            // 写入 InfluxDB
            const lineProtocol = `permissions,network_slug=${NETWORK_SLUG},role=${roleName},address=${addr} has_role=1i,block_number=${block}i ${timestamp}`;
            const success = await writeToInfluxDB(lineProtocol);
            if (success) totalWrites++;
            
            allPermissions.push({
              role: roleName,
              address: addr,
              shortAddress: shortAddr
            });
          }
        } catch (e) {
          // ignore errors for specific address checks
        }
      }
    }
    
    console.log(`✅ Wrote ${totalWrites} permission records to InfluxDB`);
    console.log(`   Total unique: ${allPermissions.length}`);
    
    return { block, totalWrites, permissions: allPermissions };
    
  } catch (error) {
    console.error(`❌ [${new Date().toISOString()}] Error polling permissions:`, error.message);
    
    // 记录错误
    const errorLine = `permissions_errors,network_slug=${NETWORK_SLUG} error="${error.message.replace(/"/g, '\\"')}" ${timestamp}`;
    await writeToInfluxDB(errorLine);
    
    return null;
  }
}

/**
 * 主函数
 */
async function main() {
  const networkName = getNetworkName();
  
  console.log("\n" + "=".repeat(60));
  console.log("🔐 Permissions Poller Started");
  console.log("=".repeat(60));
  console.log(`📡 Network: ${networkName}`);
  console.log(`💰 USDC Contract: ${USDC_ADDRESS}`);
  console.log(`⏱️  Poll Interval: ${POLL_INTERVAL_MS}ms`);
  console.log(`📦 InfluxDB Bucket: ${INFLUX_BUCKET}`);
  console.log(`🏷️  Network Slug: ${NETWORK_SLUG}`);
  console.log("=".repeat(60) + "\n");

  // 立即执行一次
  await pollPermissions();
  
  // 设置定时器
  const intervalId = setInterval(async () => {
    await pollPermissions();
  }, POLL_INTERVAL_MS);

  process.on("SIGINT", () => {
    console.log("\n🛑 Received SIGINT, stopping poller...");
    clearInterval(intervalId);
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("\n🛑 Received SIGTERM, stopping poller...");
    clearInterval(intervalId);
    process.exit(0);
  });
}

if (require.main === module) {
  main()
    .then(() => {
      console.log("✅ Permissions poller started successfully");
    })
    .catch((error) => {
      console.error("\n❌ Failed to start permissions poller:");
      console.error(error);
      process.exit(1);
    });
}

module.exports = { pollPermissions };

