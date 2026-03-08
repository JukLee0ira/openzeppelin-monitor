/**
 * TotalSupply 轮询脚本
 * 
 * 定时调用 USDC 合约的 totalSupply() 函数并将结果写入 InfluxDB
 * 用于 Supply Dashboard 的可视化数据源
 * 
 * 使用方法:
 *   # 本地测试网络 (Hardhat fork)
 *   npm run poll:supply
 * 
 *   # XDC 主网 (需要配置 XDC_RPC_URL 环境变量)
 *   npm run poll:supply:remote
 * 
 *   # 自定义轮询间隔 (毫秒)
 *   POLL_INTERVAL=30000 npm run poll:supply
 * 
 * 环境变量:
 *   INFLUXDB_URL      - InfluxDB 地址 (默认: http://149.102.157.42:8086)
 *   INFLUXDB_TOKEN   - InfluxDB token
 *   INFLUXDB_BUCKET  - bucket 名称 (默认: usdc_testdata_bucket)
 *   INFLUXDB_ORG     - org 名称 (默认: xdc)
 *   POLL_INTERVAL    - 轮询间隔毫秒 (默认: 60000)
 *   XDC_RPC_URL      - XDC RPC 地址 (仅 remote 模式需要)
 * 
 * 配置:
 *   将 config/influxdb.env.example 复制到项目根目录的 .env 并填入真实 token:
 *   cp ../config/influxdb.env.example ../.env
 *   # 然后编辑 .env 文件，替换 INFLUXDB_TOKEN 为真实值
 */

const hre = require("hardhat");
const path = require("path");
const { getProvider, getNetworkName } = require("./network");

// 加载环境变量：优先从项目根目录 .env 加载，其次从 config/influxdb.env 加载
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
require("dotenv").config({ path: path.resolve(__dirname, "../../config/influxdb.env") });

// USDC 合约地址 (XDC Mainnet)
const USDC_ADDRESS = "0xfa2958cb79b0491cc627c1557f441ef849ca8eb1";

// USDC 精度 (6 位小数)
const USDC_DECIMALS = 6;

// InfluxDB 配置 (从环境变量读取)
const INFLUX_URL = process.env.INFLUXDB_URL || "http://149.102.157.42:8086";
const INFLUX_TOKEN = process.env.INFLUXDB_TOKEN;
const INFLUX_BUCKET = process.env.INFLUXDB_BUCKET || "usdc_testdata_bucket";
const INFLUX_ORG = process.env.INFLUXDB_ORG || "xdc";
const NETWORK_SLUG = process.env.NETWORK_SLUG || "xdc_mainnet_fork_local";

// 轮询间隔 (默认 60 秒)
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "60000", 10);

// totalSupply() ABI - view function
const SUPPLY_ABI = [
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
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
 * 轮询 totalSupply 并写入 InfluxDB
 */
async function pollTotalSupply() {
  const timestamp = Date.now() * 1_000_000; // 纳秒
  
  try {
    // 获取 provider (使用统一的 network.js)
    const provider = getProvider();
    
    // 获取当前区块号
    const block = await provider.getBlockNumber();
    
    // 连接到 USDC 合约
    const usdc = new hre.ethers.Contract(USDC_ADDRESS, SUPPLY_ABI, provider);
    
    // 调用 totalSupply()
    const supply = await usdc.totalSupply();
    
    // 格式化为人类可读 (USDC 精度 6 位)
    const supplyFormatted = hre.ethers.formatUnits(supply, USDC_DECIMALS);
    
    // 将 BigInt 转换为浮点数 - 使用 formatUnits 结果直接解析
    const supplyValue = parseFloat(supplyFormatted);
    
    // 构建 line protocol
    // measurement: supply
    // tags: network_slug
    // fields: 
    //   - totalSupplyFloat (float): 数值类型，供 timeseries 使用
    //   - totalSupplyFormatted (string): 格式化后的值，方便直接查看
    //   - block_number (integer): 区块号
    const lineProtocol = `supply,network_slug=${NETWORK_SLUG} totalSupplyFloat=${supplyValue},totalSupplyFormatted="${supplyFormatted}",block_number=${block}i ${timestamp}`;
    
    console.log(`[${new Date().toISOString()}] 📊 totalSupply: ${supplyFormatted} USDC (block: ${block})`);
    console.log(`   原始值: ${supply.toString()}`);
    
    // 写入 InfluxDB
    const success = await writeToInfluxDB(lineProtocol);
    if (success) {
      console.log("✅ Written to InfluxDB");
    }
    
    return { supply, supplyFormatted, block, success };
    
  } catch (error) {
    console.error(`❌ [${new Date().toISOString()}] Error polling totalSupply:`, error.message);
    
    // 检查是否是 hardfork 错误，如果是则尝试使用最新区块重试
    if (error.message && error.message.includes("hardfork")) {
      console.log("⚠️  检测到 hardfork 错误，尝试使用最新状态重试...");
      try {
        const provider = getProvider();
        const block = await provider.getBlockNumber();
        const usdc = new hre.ethers.Contract(USDC_ADDRESS, SUPPLY_ABI, provider);
        
        // 使用 getBlock("latest") 确保获取最新状态
        const supply = await usdc.totalSupply({ blockTag: "latest" });
        const supplyFormatted = hre.ethers.formatUnits(supply, USDC_DECIMALS);
        const supplyValue = parseFloat(supplyFormatted);
        
        const lineProtocol = `supply,network_slug=${NETWORK_SLUG} totalSupplyFloat=${supplyValue},totalSupplyFormatted="${supplyFormatted}",block_number=${block}i ${timestamp}`;
        console.log(`[${new Date().toISOString()}] 📊 totalSupply (重试): ${supplyFormatted} USDC (block: ${block})`);
        
        const success = await writeToInfluxDB(lineProtocol);
        if (success) {
          console.log("✅ Written to InfluxDB (重试成功)");
          return { supply, supplyFormatted, block, success };
        }
      } catch (retryError) {
        console.error("❌ 重试也失败了:", retryError.message);
      }
    }
    
    // 记录错误到 InfluxDB (可选)
    const errorLine = `supply_errors,network_slug=${NETWORK_SLUG} error="${error.message.replace(/"/g, '\\"')}" ${timestamp}`;
    await writeToInfluxDB(errorLine);
    
    return null;
  }
}

/**
 * 主函数
 */
async function main() {
  const networkName = getNetworkName();
  const isLocal = networkName === "localhost" || networkName === "hardhat";
  
  console.log("\n" + "=".repeat(60));
  console.log("🚀 TotalSupply Poller Started");
  console.log("=".repeat(60));
  console.log(`📡 Network: ${networkName}`);
  console.log(`💰 USDC Contract: ${USDC_ADDRESS}`);
  console.log(`⏱️  Poll Interval: ${POLL_INTERVAL_MS}ms`);
  console.log(`📦 InfluxDB Bucket: ${INFLUX_BUCKET}`);
  console.log(`🏷️  Network Slug: ${NETWORK_SLUG}`);
  console.log("=".repeat(60) + "\n");

  // 立即执行一次
  await pollTotalSupply();
  
  // 设置定时器
  const intervalId = setInterval(async () => {
    await pollTotalSupply();
  }, POLL_INTERVAL_MS);

  // 优雅退出处理
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

// 直接运行时执行
if (require.main === module) {
  main()
    .then(() => {
      console.log("✅ Poller started successfully");
    })
    .catch((error) => {
      console.error("\n❌ Failed to start poller:");
      console.error(error);
      process.exit(1);
    });
}

module.exports = { pollTotalSupply };

