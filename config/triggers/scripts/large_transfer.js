/**
 * Large Transfer Detection Script
 * 
 * 检测单笔转账金额超过 totalSupply * 0.1% 的大额转账
 * 
 * Input: JSON object from stdin
 *   - monitor_match.EVM: 包含事件详情
 * 
 * Output: 告警信息到 stderr (如果有符合条件的转账)
 * 
 * 配置:
 *   - USDC_ADDRESS: USDC 合约地址
 *   - THRESHOLD_PERCENTAGE: 阈值百分比 (默认 0.1%)
 *   - RPC_URL: RPC 端点 (从环境变量读取)
 */

const { ethers } = require("ethers");
const path = require("path");

// 加载环境变量
require("dotenv").config({ path: path.resolve(__dirname, "../../../.env") });
require("dotenv").config({ path: path.resolve(__dirname, "../../../config/influxdb.env") });

// USDC 合约地址 (XDC Mainnet)
const USDC_ADDRESS = process.env.USDC_ADDRESS || "0xfa2958cb79b0491cc627c1557f441ef849ca8eb1";

// RPC URL
const RPC_URL = process.env.XDC_RPC_URL || "http://127.0.0.1:8545";

// 阈值百分比 (0.1%)
const THRESHOLD_PERCENTAGE = parseFloat(process.env.LARGE_TRANSFER_THRESHOLD || "0.1");

// USDC 精度
const USDC_DECIMALS = 6;

// totalSupply() ABI
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
 * 获取当前 totalSupply
 */
async function getTotalSupply(provider) {
  const usdc = new ethers.Contract(USDC_ADDRESS, SUPPLY_ABI, provider);
  const supply = await usdc.totalSupply();
  return supply;
}

/**
 * 格式化 USDC 金额
 */
function formatUSDC(value) {
  return ethers.formatUnits(value, USDC_DECIMALS);
}

/**
 * 主函数
 */
async function main() {
  let inputData = '';
  
  // 读取 stdin
  process.stdin.on('data', chunk => {
    inputData += chunk;
  });

  process.stdin.on('end', async () => {
    try {
      const data = JSON.parse(inputData);
      const evm = data.monitor_match?.EVM;
      
      if (!evm) {
        console.error("[Large Transfer] No EVM match data found");
        process.exit(0);
      }

      // 提取事件数据
      const events = evm.matched_on_args?.events || [];
      const network = evm.network_slug || "unknown";
      const txHash = evm.transaction?.hash || "unknown";
      const blockNumber = evm.transaction?.blockNumber || "0x0";
      const blockDec = parseInt(blockNumber, 16);

      // 过滤 Transfer 事件
      const transferEvents = events.filter(e => 
        e.signature === "Transfer(address,address,uint256)"
      );

      if (transferEvents.length === 0) {
        process.exit(0);
      }

      // 创建 provider 并获取 totalSupply
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      let totalSupply;
      try {
        totalSupply = await getTotalSupply(provider);
      } catch (e) {
        console.error("[Large Transfer] Failed to get totalSupply:", e.message);
        // 继续处理，使用默认阈值
        totalSupply = BigInt(0);
      }
      
      const threshold = (totalSupply * BigInt(Math.floor(THRESHOLD_PERCENTAGE * 10))) / BigInt(1000);
      
      console.error(`[Large Transfer] totalSupply: ${formatUSDC(totalSupply)} USDC`);
      console.error(`[Large Transfer] threshold (${THRESHOLD_PERCENTAGE}%): ${formatUSDC(threshold)} USDC`);

      // 检查每个 Transfer 事件
      let largeTransfersFound = false;
      
      for (const event of transferEvents) {
        const args = event.args || [];
        // Transfer(from, to, value) - 参数顺序
        const fromAddr = args[0] || "unknown";
        const toAddr = args[1] || "unknown";
        const value = BigInt(args[2] || "0");

        if (totalSupply > 0 && value > threshold) {
          largeTransfersFound = true;
          
          const percentage = (Number(value) / Number(totalSupply) * 100).toFixed(4);
          
          // 输出告警信息到 stderr
          console.error("=".repeat(60));
          console.error("🚨 LARGE TRANSFER ALERT!");
          console.error("=".repeat(60));
          console.error(`Network: ${network}`);
          console.error(`Block: ${blockDec}`);
          console.error(`Transaction: ${txHash}`);
          console.error(`From: ${fromAddr}`);
          console.error(`To: ${toAddr}`);
          console.error(`Amount: ${formatUSDC(value)} USDC`);
          console.error(`Total Supply: ${formatUSDC(totalSupply)} USDC`);
          console.error(`Percentage: ${percentage}%`);
          console.error(`Threshold: ${THRESHOLD_PERCENTAGE}%`);
          console.error("=".repeat(60));
        }
      }

      if (largeTransfersFound) {
        // 退出码 0 表示成功处理，有大额转账
        process.exit(0);
      } else {
        // 没有大额转账，静默退出
        process.exit(0);
      }

    } catch (error) {
      console.error(`[Large Transfer] Error: ${error.message}`);
      process.exit(0);
    }
  });
}

// 直接运行
if (require.main === module) {
  main().catch(error => {
    console.error(`[Large Transfer] Fatal error: ${error.message}`);
    process.exit(0);
  });
}

module.exports = { main };
