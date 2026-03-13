const hre = require("hardhat");

async function main() {
  console.log("=" .repeat(50));
  console.log("Network Connection Test");
  console.log("=" .repeat(50));
  
  console.log(`Network name: ${hre.network.name}`);
  console.log(`Network config:`, JSON.stringify(hre.network.config, null, 2));
  
  const blockNumber = await hre.ethers.provider.getBlockNumber();
  console.log(`Current block: ${blockNumber}`);
  
  // Check if fork is configured
  if (hre.network.config.forking) {
    console.log(`Fork URL: ${hre.network.config.forking.jsonRpcUrl}`);
    console.log(`Fork Block: ${hre.network.config.forking.blockNumber || 'latest'}`);
  } else {
    console.log("⚠️  No forking configured!");
  }
  
  console.log("=" .repeat(50));
}

main().catch(console.error);



