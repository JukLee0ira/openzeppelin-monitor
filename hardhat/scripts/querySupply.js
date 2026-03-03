/**
 * 查询 InfluxDB 中 totalSupply 数据的脚本
 * 
 * 使用方法:
 *   npm run query:supply
 * 
 * 环境变量 (同 pollSupply):
 *   INFLUXDB_URL      - InfluxDB 地址 (默认: http://149.102.157.42:8086)
 *   INFLUXDB_TOKEN   - InfluxDB token
 *   INFLUXDB_BUCKET  - bucket 名称 (默认: usdc_testdata_bucket)
 *   INFLUXDB_ORG     - org 名称 (默认: xdc)
 */

const hre = require("hardhat");
const path = require("path");

// 加载环境变量
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
require("dotenv").config({ path: path.resolve(__dirname, "../../config/influxdb.env") });

// InfluxDB 配置
const INFLUX_URL = process.env.INFLUXDB_URL || "http://149.102.157.42:8086";
const INFLUX_TOKEN = process.env.INFLUXDB_TOKEN;
const INFLUX_BUCKET = process.env.INFLUXDB_BUCKET || "usdc_testdata_bucket";
const INFLUX_ORG = process.env.INFLUXDB_ORG || "xdc";

// USDC 精度 (6 位小数)
const USDC_DECIMALS = 6;

/**
 * 使用 Flux 查询 InfluxDB v2
 */
async function queryInfluxDB(fluxQuery) {
  if (!INFLUX_TOKEN) {
    console.error("❌ INFLUXDB_TOKEN not set. Please configure it in .env or config/influxdb.env");
    process.exit(1);
  }

  try {
    const response = await fetch(
      `${INFLUX_URL}/api/v2/query?org=${INFLUX_ORG}`,
      {
        method: "POST",
        headers: {
          "Authorization": `Token ${INFLUX_TOKEN}`,
          "Content-Type": "application/vnd.flux"
        },
        body: fluxQuery
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`InfluxDB error ${response.status}: ${errorText}`);
    }

    return await response.text();
  } catch (error) {
    console.error("❌ 查询失败:", error.message);
    return null;
  }
}

/**
 * 格式化 USDC 金额
 */
function formatUSDC(rawValue) {
  // 原始值是整数，需要除以 10^6 转换为实际金额
  const value = BigInt(rawValue);
  const divisor = BigInt(10) ** BigInt(USDC_DECIMALS);
  
  const integerPart = value / divisor;
  const decimalPart = value % divisor;
  
  // 补齐前导零
  const decimalStr = decimalPart.toString().padStart(USDC_DECIMALS, '0');
  
  return `${integerPart.toString()}.${decimalStr}`;
}

/**
 * 主函数
 */
async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("📊 InfluxDB TotalSupply 查询");
  console.log("=".repeat(60));
  console.log(`📦 Bucket: ${INFLUX_BUCKET}`);
  console.log(`🏢 Org: ${INFLUX_ORG}`);
  console.log(`🔗 URL: ${INFLUX_URL}`);
  console.log(`💰 USDC 精度: ${USDC_DECIMALS} 位小数`);
  console.log("=".repeat(60) + "\n");

  // 查询最近的数据 (使用 Flux)
  // 查询 totalSupplyFormatted 字段（格式化后的字符串值）
  const fluxQuery = `
from(bucket: "${INFLUX_BUCKET}")
  |> range(start: -30d)
  |> filter(fn: (r) => r._measurement == "supply")
  |> filter(fn: (r) => r._field == "totalSupplyFormatted")
  |> sort(columns: ["_time"], desc: true)
  |> limit(n: 10)
`;

  console.log("🔍 执行 Flux 查询...\n");
  
  const result = await queryInfluxDB(fluxQuery);
  
  if (result) {
    console.log("📋 原始查询结果:");
    console.log("-".repeat(60));
    console.log(result);
    console.log("-".repeat(60));
    
    // 解析并格式化
    console.log("\n💰 查询结果:");
    console.log("-".repeat(60));
    
    // 解析每行数据 (CSV 格式: ,result,table,_start,_stop,_time,_value,_field,_measurement,network_slug)
    const lines = result.trim().split('\n');
    let hasData = false;
    
    for (const line of lines) {
      // 跳过表头行和空行
      if (line.startsWith(',result') || line.startsWith(',_result') === false || !line.includes('totalSupplyFormatted')) {
        continue;
      }
      
      // 解析 CSV
      const parts = line.split(',');
      
      // 格式: ,_result,0,start,stop,time,value,field,measurement,network_slug
      if (parts.length >= 7) {
        const time = parts[5]?.replace('_time=', '') || 'unknown';
        const value = parts[6] || 'N/A';
        
        console.log(`⏰ 时间: ${time}`);
        console.log(`💰 TotalSupply: ${value} USDC`);
        console.log("-".repeat(40));
        hasData = true;
      }
    }
    
    if (!hasData) {
      console.log("⚠️  未找到 supply 测量数据");
    }
  }
  
  console.log("\n✅ 查询完成");
}

// 直接运行时执行
if (require.main === module) {
  main()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n❌ 脚本执行失败:");
      console.error(error);
      process.exit(1);
    });
}

module.exports = { formatUSDC };

