const hre = require("hardhat");
const { getSigners, resetFork, impersonateAccount, stopImpersonating, getContractWithSigner, getRpcUrl } = require("./network");

/**
 * Simple Transfer event injection demo.
 *
 * Usage:
 *   npm run demo:emit:transfer         # Single run, reset fork first
 *   NO_RESET=true npm run demo:emit:transfer   # Don't reset fork
 *   TRANSFER_AMOUNT=100 npm run demo:emit:transfer   # Transfer 100 USDC
 */

const USDC_ADDRESS =  "0xfa2958cb79b0491cc627c1557f441ef849ca8eb1";
const MASTER_MINTER_ADDRESS = "0x95957689132Db66CE1B773F681eF2349B7D35127";
const TRANSFER_AMOUNT = 55n;

// ABI for USDC FiatToken contract
const TOKEN_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
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
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: []
  }
];

async function main() {
  const noReset = process.env.NO_RESET === "true";

  console.log('\n' + '='.repeat(70));
  console.log('💸 Transfer event injection demo script');
  console.log('='.repeat(70));
  console.log(`Mode: Fork ${noReset ? '(NO RESET)' : '(RESET)'}`);
  console.log(`Target: ${USDC_ADDRESS}`);
  console.log(`Transfer Amount: ${TRANSFER_AMOUNT}`);

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

  // Step 1: Check balance and mint if needed
  console.log(`\n💰 Step 1: Checking signer0 balance...`);
  try {
    const balance = await token.balanceOf(signer0.address);
    console.log(`   Signer0 balance: ${balance} USDC`);
    if (balance < TRANSFER_AMOUNT) {
      console.log(`   ⚠️ Insufficient balance, minting via masterMinter...`);
      
      // Impersonate masterMinter and configure signer0 as minter
      const masterSigner = await impersonateAccount(MASTER_MINTER_ADDRESS);
      const tokenAsMaster = getContractWithSigner(USDC_ADDRESS, masterSigner, TOKEN_ABI);
      
      try {
        const txC = await tokenAsMaster.configureMinter(signer0.address, TRANSFER_AMOUNT * 10000n);
        await txC.wait();
        console.log(`   ✅ Configured signer0 as minter`);
      } finally {
        await stopImpersonating(MASTER_MINTER_ADDRESS);
      }
      
      // Mint to signer0
      const txM = await token.mint(signer0.address, TRANSFER_AMOUNT);
      await txM.wait();
      console.log(`   ✅ Minted ${TRANSFER_AMOUNT} USDC to signer0`);
    }
  } catch (e) {
    console.log(`   ⚠️ Failed to get/mint balance: ${e.message?.substring(0, 80)}`);
  }

  // Step 2: Transfer as signer0
  console.log(`\n💸 Step 2: Transferring ${TRANSFER_AMOUNT} USDC...`);
  try {
    const txT = await token.transfer(signer1.address, TRANSFER_AMOUNT);
    const rT = await txT.wait();
    console.log(`   ✅ Transfer success!`);
    console.log(`   From: ${signer0.address}`);
    console.log(`   To: ${signer1.address}`);
    console.log(`   Amount: ${TRANSFER_AMOUNT} USDC`);
    console.log(`   Block: ${rT.blockNumber}`);
    console.log(`   Tx: ${rT.hash}`);
  } catch (e) {
    console.log(`   ❌ Transfer failed: ${e.message?.substring(0, 100)}`);
    throw e;
  }

  console.log('\n' + '='.repeat(70));
  console.log('✅ Transfer event injection completed');
  console.log('='.repeat(70));
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('\n❌ Transfer event injection failed:');
      console.error(error);
      process.exit(1);
    });
}

module.exports = main;

