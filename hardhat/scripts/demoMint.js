const hre = require("hardhat");

/**
 * Simple Mint event injection demo.
 *
 * Usage:
 *   npm run demo:emit:mint           # Single run, reset fork first
 *   NO_RESET=true npm run demo:emit:mint   # Don't reset fork
 *   MINT_AMOUNT=5000 npm run demo:emit:mint   # Mint 5000 USDC
 */

const USDC_ADDRESS = "0xfa2958cb79b0491cc627c1557f441ef849ca8eb1";
const MASTER_MINTER_ADDRESS = "0x95957689132Db66CE1B773F681eF2349B7D35127";
const MINT_AMOUNT = 25n;
const MINT_DELAY_MS = 5000; // Delay between each mint (3 seconds)

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const noReset = process.env.NO_RESET === "true";

  console.log('\n' + '='.repeat(70));
  console.log('Mint event injection demo script');
  console.log('='.repeat(70));
  console.log(`Mode: Fork ${noReset ? '(NO RESET)' : '(RESET)'}`);
  console.log(`Target: ${USDC_ADDRESS}`);
  console.log(`MasterMinter: ${MASTER_MINTER_ADDRESS}`);
  console.log(`Mint Amount: ${MINT_AMOUNT}`);
  console.log(`Mint Delay: ${MINT_DELAY_MS}ms`);

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

  // Get signers - use first 3 signers as minters
  const signers = await hre.ethers.getSigners();
  const minterAddresses = [signers[0].address, signers[1].address, signers[2].address];

  console.log(`\n👤 Minter Addresses:`);
  minterAddresses.forEach((addr, i) => console.log(`   Minter${i + 1}: ${addr}`));

  // Step 1: Impersonate masterMinter and configure 3 minter addresses
  console.log(`\n🔧 Step 1: Configuring 3 minters...`);
  const masterSigner = await impersonate(MASTER_MINTER_ADDRESS);
  const tokenAsMaster = new hre.ethers.Contract(USDC_ADDRESS, TOKEN_ABI, masterSigner);

  for (let i = 0; i < minterAddresses.length; i++) {
    try {
      const txC = await tokenAsMaster.configureMinter(minterAddresses[i], MINT_AMOUNT * 10000n);
      await txC.wait();
      console.log(`   ✅ Configured Minter${i + 1} (${minterAddresses[i]}) with limit ${MINT_AMOUNT * 10000n}`);
    } catch (e) {
      console.log(`   ⚠️ configureMinter for Minter${i + 1} failed: ${e.message?.substring(0, 80)}`);
    }
  }
  await stopImpersonate(MASTER_MINTER_ADDRESS);

  // Step 2: Mint from each minter
  console.log(`\n🪙 Step 2: Minting from 3 minters...`);
  for (let i = 0; i < minterAddresses.length; i++) {
    try {
      const tokenAsMinter = new hre.ethers.Contract(USDC_ADDRESS, TOKEN_ABI, signers[i]);
      const txM = await tokenAsMinter.mint(signers[3].address, MINT_AMOUNT);
      const rM = await txM.wait();
      console.log(`   ✅ Minter${i + 1} minted ${MINT_AMOUNT} USDC!`);
      console.log(`      Block: ${rM.blockNumber}, Tx: ${rM.hash}`);
    } catch (e) {
      console.log(`   ❌ Minter${i + 1} mint failed: ${e.message?.substring(0, 100)}`);
    }
    // Wait between mints to allow monitor to catch each event
    if (i < minterAddresses.length - 1) {
      console.log(`   ⏳ Waiting ${MINT_DELAY_MS}ms before next mint...`);
      await sleep(MINT_DELAY_MS);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('✅ Mint event injection completed');
  console.log('='.repeat(70));
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('\n❌ Mint event injection failed:');
      console.error(error);
      process.exit(1);
    });
}

module.exports = main;
