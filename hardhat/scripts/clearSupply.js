/**
 * 清空 InfluxDB 中所有 totalSupply 数据的脚本
 * 
 * 使用方法:
 *   npm run clear:supply
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

/**
 * 使用 InfluxDB DELETE API 删除数据
 * 
 * InfluxDB v2 DELETE API:
 *   POST /api/v2/delete
 *   Header: Authorization: Token <token>
 *   Body: {
 *     "start": "1970-01-01T00:00:00Z",
 *     "stop": "2026-03-03T23:59:59Z",
 *     "predicate": "_measurement == \"supply\""
 *   }
 */
async function deleteSupplyData() {
  if (!INFLUX_TOKEN) {
    console.error("❌ INFLUXDB_TOKEN not set. Please configure it in .env or config/influxdb.env");
    process.exit(1);
  }

  console.log("\n" + "=".repeat(60));
  console.log("🗑️  InfluxDB TotalSupply Data Deletion");
  console.log("=".repeat(60));
  console.log(`📦 Bucket: ${INFLUX_BUCKET}`);
  console.log(`🏢 Org: ${INFLUX_ORG}`);
  console.log(`🔗 URL: ${INFLUX_URL}`);
  console.log("=".repeat(60) + "\n");

  // 首先查询一下有多少数据
  console.log("📊 查询现有数据...");
  try {
    const queryResponse = await fetch(
      `${INFLUX_URL}/api/v2/query?org=${INFLUX_ORG}`,
      {
        method: "POST",
        headers: {
          "Authorization": `Token ${INFLUX_TOKEN}`,
          "Content-Type": "application/vnd.influxql"
        },
        body: `SELECT count(*) FROM supply WHERE _field = 'totalSupply'`
      }
    );

    if (queryResponse.ok) {
      const text = await queryResponse.text();
      console.log("📈 当前数据统计:", text.substring(0, 500));
    } else {
      console.log("⚠️  无法查询数据统计:", queryResponse.status);
    }
  } catch (error) {
    console.log("⚠️  查询统计时出错:", error.message);
  }

  // 删除所有 supply 数据
  // 使用时间范围从 1970-01-01 到未来某个时间点，覆盖所有数据
  const startTime = "1970-01-01T00:00:00Z";
  const stopTime = "2030-01-01T00:00:00Z";  // 使用未来时间确保覆盖所有数据
  
  // predicate: 删除 measurement = "supply" 的所有数据
  // 包括 totalSupply 和 block_number 字段
  // 注意：predicate 不需要引号，直接使用字符串
  const predicate = '_measurement = "supply"';

  console.log(`\n🗑️  正在删除数据...`);
  console.log(`   Predicate: ${predicate}`);
  console.log(`   Time range: ${startTime} 到 ${stopTime}`);

  try {
    // InfluxDB v2 DELETE API 需要将 predicate 进行 URL 编码
    const encodedPredicate = encodeURIComponent(predicate);
    const deleteUrl = `${INFLUX_URL}/api/v2/delete?org=${INFLUX_ORG}&bucket=${INFLUX_BUCKET}&predicate=${encodedPredicate}`;

    const response = await fetch(
      deleteUrl,
      {
        method: "POST",
        headers: {
          "Authorization": `Token ${INFLUX_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          start: startTime,
          stop: stopTime
        })
      }
    );

    if (response.ok) {
      console.log("\n✅ 成功删除所有 totalSupply 数据!");
      
      // 再次查询确认数据已删除
      console.log("\n📊 验证删除结果...");
      try {
        const verifyResponse = await fetch(
          `${INFLUX_URL}/api/v2/query?org=${INFLUX_ORG}`,
          {
            method: "POST",
            headers: {
              "Authorization": `Token ${INFLUX_TOKEN}`,
              "Content-Type": "application/vnd.influxql"
            },
            body: `SELECT count(*) FROM supply WHERE _field = 'totalSupply'`
          }
        );

        if (verifyResponse.ok) {
          const text = await verifyResponse.text();
          console.log("📈 剩余数据统计:", text.substring(0, 500));
        }
      } catch (e) {
        console.log("⚠️  验证查询出错:", e.message);
      }
      
    } else {
      const errorText = await response.text();
      console.error(`\n❌ 删除失败: ${response.status}`);
      console.error("错误详情:", errorText);
      process.exit(1);
    }
  } catch (error) {
    console.error("\n❌ 删除过程中出错:", error.message);
    process.exit(1);
  }
}

// 直接运行时执行
if (require.main === module) {
  deleteSupplyData()
    .then(() => {
      console.log("\n✅ 脚本执行完成");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n❌ 脚本执行失败:");
      console.error(error);
      process.exit(1);
    });
}

module.exports = { deleteSupplyData };

