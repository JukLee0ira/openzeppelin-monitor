const hre = require("hardhat");

/**
 * Simple Mint event injection demo.
 *
 * Usage:
 *   npm run demo:emit:mint           # Single run, reset fork first
 *   NO_RESET=true npm run demo:emit:mint   # Don't reset fork
 *   USDC_ADDRESS=0x... MASTER_MINTER=0x... MINT_AMOUNT=1000 npm run demo:emit:mint
 *   MINT_AMOUNT=5000 npm run demo:emit:mint   # Mint 5000 USDC
 */

const USDC_ADDRESS =  "0xfa2958cb79b0491cc627c1557f441ef849ca8eb1";
const MASTER_MINTER_ADDRESS = "0x95957689132Db66CE1B773F681eF2349B7D35127";
const MINT_AMOUNT =90n;

// ABI for USDC FiatToken contract
const TOKEN_ABI = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "configureMinter",
    stateMutability: "nonpayable",
    inputs: [
      { name: "minter", type: "address" },
      { name: "minterAllowedAmount", type: "uint256" }
    ],
    outputs: [{ name: "", type: "bool" }]
  }
];

async function setBalance(address) {
  await hre.network.provider.send("hardhat_setBalance", [address, "0x56BC75E2D63100000"]);
}

async function impersonate(address) {
  await hre.network.provider.send("hardhat_impersonateAccount", [address]);
  await setBalance(address);
  return await hre.ethers.getSigner(address);
}

async function stopImpersonate(address) {
  await hre.network.provider.send("hardhat_stopImpersonatingAccount", [address]);
}

async function main() {
  const noReset = process.env.NO_RESET === "true";

  console.log('\n' + '='.repeat(70));
  console.log('🪙 Mint 事件演示脚本');
  console.log('='.repeat(70));
  console.log(`Mode: Fork ${noReset ? '(NO RESET)' : '(RESET)'}`);
  console.log(`Target: ${USDC_ADDRESS}`);
  console.log(`MasterMinter: ${MASTER_MINTER_ADDRESS}`);
  console.log(`Mint Amount: ${MINT_AMOUNT}`);

  // Reset fork (unless NO_RESET=true)
  if (!noReset) {
    const upstream = process.env.XDC_RPC_URL || "https://rpc.ankr.com/xdc";
    console.log(`\n🔄 Resetting fork from ${upstream}...`);
    await hre.network.provider.send("hardhat_reset", [
      { forking: { jsonRpcUrl: upstream } }
    ]);
    console.log(`✅ Fork reset complete`);
  } else {
    console.log(`\n⏭️ Skipping fork reset (NO_RESET=true)`);
  }

  // Get signers
  const [signer0, signer1] = await hre.ethers.getSigners();
  console.log(`\n👤 Signer0: ${signer0.address}`);
  console.log(`   Signer1: ${signer1.address}`);

  const token = new hre.ethers.Contract(USDC_ADDRESS, TOKEN_ABI, signer0);

  // Step 1: Impersonate masterMinter and configure signer0 as minter
  console.log(`\n🔧 Step 1: Configuring signer0 as minter...`);
  const masterSigner = await impersonate(MASTER_MINTER_ADDRESS);
  const tokenAsMaster = new hre.ethers.Contract(USDC_ADDRESS, TOKEN_ABI, masterSigner);

  try {
    const txC = await tokenAsMaster.configureMinter(signer0.address, MINT_AMOUNT * 10000n);
    await txC.wait();
    console.log(`   ✅ Configured signer0 as minter (limit: ${MINT_AMOUNT * 10000n})`);
  } catch (e) {
    console.log(`   ⚠️ configureMinter failed: ${e.message?.substring(0, 80)}`);
    await stopImpersonate(MASTER_MINTER_ADDRESS);
    throw e;
  }
  await stopImpersonate(MASTER_MINTER_ADDRESS);

  // Step 2: Mint as signer0
  console.log(`\n🪙 Step 2: Minting ${MINT_AMOUNT} USDC...`);
  try {
    const txM = await token.mint(signer1.address, MINT_AMOUNT);
    const rM = await txM.wait();
    console.log(`   ✅ Mint success!`);
    console.log(`   From: ${signer0.address}`);
    console.log(`   To: ${signer1.address}`);
    console.log(`   Amount: ${MINT_AMOUNT} USDC`);
    console.log(`   Block: ${rM.blockNumber}`);
    console.log(`   Tx: ${rM.hash}`);
  } catch (e) {
    console.log(`   ❌ Mint failed: ${e.message?.substring(0, 100)}`);
    throw e;
  }

  console.log('\n' + '='.repeat(70));
  console.log('✅ Mint 事件注入完成');
  console.log('='.repeat(70));
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('\n❌ Mint 事件演示失败:');
      console.error(error);
      process.exit(1);
    });
}

module.exports = main;
