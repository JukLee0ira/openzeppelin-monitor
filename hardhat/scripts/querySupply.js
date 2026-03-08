const hre = require("hardhat");

const USDC_ADDRESS = "0xfa2958cb79b0491cc627c1557f441ef849ca8eb1";

const SUPPLY_ABI = [{
  type: "function",
  name: "totalSupply",
  stateMutability: "view",
  inputs: [],
  outputs: [{ name: "", type: "uint256" }]
}];

async function main() {
  const provider = hre.ethers.provider;
  const block = await provider.getBlockNumber();
  const usdc = new hre.ethers.Contract(USDC_ADDRESS, SUPPLY_ABI, provider);
  const supply = await usdc.totalSupply();
  const supplyFormatted = hre.ethers.formatUnits(supply, 6);
  
  console.log(`Block: ${block}`);
  console.log(`totalSupply: ${supplyFormatted} USDC`);
  console.log(`raw: ${supply.toString()}`);
}

main().catch(console.error);
