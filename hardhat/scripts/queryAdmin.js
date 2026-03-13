const hre = require("hardhat");
const USDC = "0xfa2958cb79b0491cc627c1557f441ef849ca8eb1";

const ABI = [
  { type: "function", name: "hasRole", stateMutability: "view", inputs: [{ name: "role", type: "bytes32" }, { name: "account", type: "address" }], outputs: [{ name: "", type: "bool" }] }
];

const DEFAULT_ADMIN = "0x0000000000000000000000000000000000000000000000000000000000000000";
const MINTER_ROLE = "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6";

const XDC_RPC_URL = process.env.XDC_RPC_URL || "https://rpc.ankr.com/xdc";

async function main() {
  // Reset fork first
  console.log("Resetting fork...");
  await hre.network.provider.send("hardhat_reset", [{
    forking: {
      jsonRpcUrl: XDC_RPC_URL
    }
  }]);
  console.log("Fork reset done");
  
  // Get contract at latest block
  const usdc = new hre.ethers.Contract(USDC, ABI, hre.ethers.provider);
  
  const addresses = [
    "0xa4ba017d08b1f030b83a5947615a5a8a5a26be2e",
    "0x95957689132Db66CE1B773F681eF2349B7D35127"
  ];
  
  console.log("\nChecking roles at latest block:");
  for (const addr of addresses) {
    try {
      const hasAdmin = await usdc.hasRole(DEFAULT_ADMIN, addr, { blockTag: "latest" });
      const hasMinter = await usdc.hasRole(MINTER_ROLE, addr, { blockTag: "latest" });
      console.log(`  ${addr.slice(0,10)}...: admin=${hasAdmin}, minter=${hasMinter}`);
    } catch (e) {
      console.log(`  ${addr.slice(0,10)}...: ERROR - ${e.message.substring(0, 60)}`);
    }
  }
}
main();
