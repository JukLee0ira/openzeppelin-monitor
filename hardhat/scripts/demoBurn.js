const hre = require("hardhat");
const { getSigners, resetFork, impersonateAccount, stopImpersonating, getContractWithSigner, getRpcUrl, getProvider } = require("./network");

/**
 * Simple Burn event injection demo.
 *
 * Usage:
 *   npm run demo:emit:burn           # Single run, reset fork first
 *   NO_RESET=true npm run demo:emit:burn   # Don't reset fork
 *   USDC_ADDRESS=0x... MASTER_MINTER=0x... BURN_AMOUNT=100 npm run demo:emit:burn
 *   BURN_AMOUNT=50 npm run demo:emit:burn   # Burn 50 USDC
 */

const USDC_ADDRESS =  "0xfa2958cb79b0491cc627c1557f441ef849ca8eb1";
const MASTER_MINTER_ADDRESS = "0x95957689132Db66CE1B773F681eF2349B7D35127";
const BURN_AMOUNT = 10n;

// ABI for USDC FiatToken contract (including burn function)
const TOKEN_ABI = [
  {
    type: "function",
    name: "burn",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_amount", type: "uint256" }
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
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" }
    ],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "isMinter",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" }
    ],
    outputs: [{ name: "", type: "bool" }]
  },
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
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" }
    ],
    outputs: [{ name: "", type: "bool" }]
  }
];

async function main() {
  const noReset = process.env.NO_RESET === "true";

  console.log('\n' + '='.repeat(70));
  console.log('🔥 Burn event injection demo script');
  console.log('='.repeat(70));
  console.log(`Mode: Fork ${noReset ? '(NO RESET)' : '(RESET)'}`);
  console.log(`Target: ${USDC_ADDRESS}`);
  console.log(`MasterMinter: ${MASTER_MINTER_ADDRESS}`);
  console.log(`Burn Amount: ${BURN_AMOUNT}`);

  // Reset fork (unless NO_RESET=true)
  if (!noReset) {
    const upstream = getRpcUrl();
    console.log(`\n🔄 Resetting fork from ${upstream}...`);
    await resetFork(upstream);
    console.log(`✅ Fork reset complete`);
  } else {
    console.log(`\n⏭️ Skipping fork reset (NO_RESET=true)`);
  }

  // Get signers
  const [signer0, signer1] = await getSigners();
  console.log(`\n👤 Signer0: ${signer0.address}`);
  console.log(`   Signer1: ${signer1.address}`);

  const token = getContractWithSigner(USDC_ADDRESS, signer0, TOKEN_ABI);

  // Step 1: Configure signer0 as minter
  console.log(`\n🔧 Step 1: Configuring signer0 as minter...`);
  const masterSigner = await impersonateAccount(MASTER_MINTER_ADDRESS);
  const tokenAsMaster = getContractWithSigner(USDC_ADDRESS, masterSigner, TOKEN_ABI);

  try {
    const txC = await tokenAsMaster.configureMinter(signer0.address, BURN_AMOUNT * 10000n);
    await txC.wait();
    console.log(`   ✅ Configured signer0 as minter (limit: ${BURN_AMOUNT * 10000n})`);
  } catch (e) {
    console.log(`   ⚠️ configureMinter failed: ${e.message?.substring(0, 80)}`);
    await stopImpersonating(MASTER_MINTER_ADDRESS);
    throw e;
  }
  await stopImpersonating(MASTER_MINTER_ADDRESS);

  // Step 2: Mint to signer0 (so they have tokens to burn)
  console.log(`\n💰 Step 2: Minting ${BURN_AMOUNT} USDC to signer0...`);
  try {
    const txM = await token.mint(signer0.address, BURN_AMOUNT);
    await txM.wait();
    console.log(`   ✅ Minted ${BURN_AMOUNT} USDC to signer0`);
  } catch (e) {
    console.log(`   ❌ Mint failed: ${e.message?.substring(0, 100)}`);
    throw e;
  }

  // Step 3: Burn as signer0
  console.log(`\n🔥 Step 3: Burning ${BURN_AMOUNT} USDC...`);
  try {
    const txB = await token["burn"](BURN_AMOUNT);
    const rB = await txB.wait();
    console.log(`   ✅ Burn success!`);
    console.log(`   Burner: ${signer0.address}`);
    console.log(`   Amount: ${BURN_AMOUNT} USDC`);
    console.log(`   Block: ${rB.blockNumber}`);
    console.log(`   Tx: ${rB.hash}`);

    // Parse the Burn event from the receipt
    const burnTopic = hre.ethers.id("Burn(address,uint256)");
    const burnLog = rB.logs.find(log => log.topics[0] === burnTopic);
    if (burnLog) {
      const burnerAddress = "0x" + burnLog.topics[1].slice(26);
      const burnAmount = BigInt(burnLog.data);
      console.log(`   Event: Burn(${burnerAddress}, ${burnAmount})`);
    }
  } catch (e) {
    console.log(`   ❌ Burn failed: ${e.message?.substring(0, 100)}`);
    throw e;
  }

  // Step 4: Get signer0's balance after burn
  console.log(`\n📊 Step 4: Checking balance after burn...`);
  try {
    const provider = getProvider();
    const balanceAfterData = await provider.send("eth_call", [{
      to: USDC_ADDRESS,
      data: "0x70a08231000000000000000000000000" + signer0.address.slice(2).toLowerCase()
    }, "latest"]);
    const balanceAfter = balanceAfterData ? BigInt(balanceAfterData) : 0n;
    console.log(`   Signer0 balance after: ${balanceAfter}`);
  } catch (e) {
    console.log(`   ⚠️ Failed to get balance after burn: ${e.message?.substring(0, 60)}`);
  }

  console.log('\n' + '='.repeat(70));
  console.log('✅ Burn event injection completed');
  console.log('='.repeat(70));
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('\n❌ Burn event injection failed:');
      console.error(error);
      process.exit(1);
    });
}

module.exports = main;

