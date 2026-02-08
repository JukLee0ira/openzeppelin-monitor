const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * Real-mode demo for continuous event injection testing.
 *
 * Usage:
 *   npm run demo:emit:real                    # Single run, reset fork first
 *   npm run demo:emit:real:continuous         # Continuous mode: inject events periodically
 *   NO_RESET=true npm run demo:emit:real      # Don't reset fork, use existing state
 *
 * Continuous mode options:
 *   INTERVAL=30        # Seconds between injections (default: 60)
 *   COUNT=10           # Number of injections (default: infinite)
 *   INJECT_MINT=true   # Inject Mint events
 *   INJECT_PAUSE=true  # Inject Pause events
 *   INJECT_TRANSFER=true  # Inject Transfer events
 *   INJECT_UPGRADED=true  # Inject Upgraded events
 */

const DEFAULT_TARGET = "0xfa2958cb79b0491cc627c1557f441ef849ca8eb1";
const DEFAULT_INTERVAL = 60;

// EIP-1967 slots
const EIP1967_ADMIN_SLOT =
  "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";
const EIP1967_IMPL_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

// ABI definitions
const MINIMAL_TOKEN_ABI = [
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
    name: "pause",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: []
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
    name: "pauser",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }]
  },
  {
    type: "function",
    name: "masterMinter",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }]
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

function storageWordToAddress(word) {
  if (!word || typeof word !== "string" || !word.startsWith("0x") || word.length !== 66) {
    return null;
  }
  return hre.ethers.getAddress("0x" + word.slice(26));
}

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

async function tryCall(contract, fn, args = []) {
  try {
    return await contract[fn](...args);
  } catch (e) {
    return null;
  }
}

function topicToAddress(topic) {
  if (!topic || typeof topic !== "string" || !topic.startsWith("0x") || topic.length !== 66) {
    return null;
  }
  return hre.ethers.getAddress("0x" + topic.slice(26));
}

// ============================================================================
// Event Injection Functions
// ============================================================================

async function injectTransfer(token, target, signer0) {
  console.log(`\n[${new Date().toISOString()}] Injecting Transfer event...`);
  try {
    const txT = await token.transfer(signer0.address, 0n);
    const rT = await txT.wait();
    console.log(`  ✓ Transfer(0) sent, block=${rT.blockNumber}, tx=${rT.hash}`);
    return true;
  } catch (e) {
    console.log(`  ✗ Transfer failed: ${e.message || e}`);
    return false;
  }
}

async function injectMint(token, target, tokenAbi, signer0) {
  console.log(`\n[${new Date().toISOString()}] Injecting Mint event...`);

  const mintTopic0 = hre.ethers.id("Mint(address,address,uint256)");
  const minterEnv = process.env.MINTER_ADDRESS ? hre.ethers.getAddress(process.env.MINTER_ADDRESS) : null;

  // Try to mint as a specific address
  const tryMintAs = async (minterAddr) => {
    const minterSigner = await impersonate(minterAddr);
    const tokenAsMinter = new hre.ethers.Contract(target, tokenAbi, minterSigner);
    try {
      const txM = await tokenAsMinter["mint"](signer0.address, 1n);
      const rM = await txM.wait();
      console.log(`  ✓ Mint from minter=${minterAddr}, block=${rM.blockNumber}, tx=${rM.hash}`);
      return true;
    } catch (e) {
      console.log(`  ✗ Mint from minter=${minterAddr} failed: ${e.message?.substring(0, 100) || e}`);
      return false;
    } finally {
      await stopImpersonate(minterAddr);
    }
  };

  let minted = false;

  // Priority 1: MINTER_ADDRESS env
  if (minterEnv) {
    minted = await tryMintAs(minterEnv);
    if (minted) return true;
  }

  // Priority 2: Configure signer0 as minter via masterMinter
  const mm = await tryCall(token, "masterMinter");
  const masterMinter = mm ? hre.ethers.getAddress(mm) : null;
  if (masterMinter) {
    console.log(`  Found masterMinter: ${masterMinter}`);
    const masterSigner = await impersonate(masterMinter);
    const tokenAsMaster = new hre.ethers.Contract(target, tokenAbi, masterSigner);
    try {
      const txC = await tokenAsMaster["configureMinter"](signer0.address, 1000000n);
      await txC.wait();
      console.log(`  ✓ Configured signer0 as minter`);
    } catch (e) {
      console.log(`  configureMinter failed: ${e.message?.substring(0, 100) || e}`);
    } finally {
      await stopImpersonate(masterMinter);
    }

    try {
      const txM2 = await token["mint"](signer0.address, 1n);
      const rM2 = await txM2.wait();
      console.log(`  ✓ Mint from signer0, block=${rM2.blockNumber}, tx=${rM2.hash}`);
      return true;
    } catch (e) {
      console.log(`  ✗ Mint from signer0 failed: ${e.message?.substring(0, 100) || e}`);
    }
  }

  // Priority 3: Discover minter from logs
  if (!minted) {
    try {
      const latest = await hre.ethers.provider.getBlockNumber();
      const searchBlocks = BigInt(process.env.MINT_SEARCH_BLOCKS || "5000");
      const from = latest > Number(searchBlocks) ? latest - Number(searchBlocks) : 0;
      const logs = await hre.ethers.provider.getLogs({
        address: target,
        fromBlock: from,
        toBlock: latest,
        topics: [mintTopic0]
      });
      if (logs.length > 0) {
        const discovered = logs[0]?.topics?.[1] ? topicToAddress(logs[0].topics[1]) : null;
        if (discovered) {
          console.log(`  Discovered minter from logs: ${discovered}`);
          return await tryMintAs(discovered);
        }
      }
      console.log(`  No minter found in logs (${searchBlocks} blocks)`);
    } catch (e) {
      console.log(`  Mint log search failed: ${e.message?.substring(0, 100) || e}`);
    }
  }

  return false;
}

// async function injectPause(token, target, tokenAbi) {
//   console.log(`\n[${new Date().toISOString()}] Injecting Pause event...`);

//   const pauserEnv = process.env.PAUSER_ADDRESS ? hre.ethers.getAddress(process.env.PAUSER_ADDRESS) : null;
//   let pauserAddr = pauserEnv;

//   if (!pauserAddr) {
//     const p = await tryCall(token, "pauser");
//     pauserAddr = p ? hre.ethers.getAddress(p) : null;
//   }

//   if (pauserAddr) {
//     const pauserSigner = await impersonate(pauserAddr);
//     const tokenAsPauser = new hre.ethers.Contract(target, tokenAbi, pauserSigner);
//     try {
//       const txP = await tokenAsPauser["pause"]();
//       const rP = await txP.wait();
//       console.log(`  ✓ Pause from pauser=${pauserAddr}, block=${rP.blockNumber}, tx=${rP.hash}`);
//       return true;
//     } catch (e) {
//       console.log(`  ✗ Pause failed: ${e.message?.substring(0, 100) || e}`);
//       return false;
//     } finally {
//       await stopImpersonate(pauserAddr);
//     }
//   } else {
//     console.log(`  ✗ No pauser available (env PAUSER_ADDRESS or pauser() getter)`);
//     return false;
//   }
// }

// async function injectUpgraded(target, proxyAbi) {
//   console.log(`\n[${new Date().toISOString()}] Injecting Upgraded event...`);

//   const adminWord = await hre.ethers.provider.getStorage(target, EIP1967_ADMIN_SLOT);
//   const implWord = await hre.ethers.provider.getStorage(target, EIP1967_IMPL_SLOT);
//   const admin = storageWordToAddress(adminWord);
//   const impl = storageWordToAddress(implWord);

//   if (admin && impl && admin !== hre.ethers.ZeroAddress && impl !== hre.ethers.ZeroAddress) {
//     console.log(`  EIP-1967: admin=${admin}, impl=${impl}`);
//     try {
//       const adminSigner = await impersonate(admin);
//       const proxy = new hre.ethers.Contract(target, proxyAbi, adminSigner);
//       const txU = await proxy["upgradeTo"](impl);
//       const rU = await txU.wait();
//       console.log(`  ✓ Upgraded, block=${rU.blockNumber}, tx=${rU.hash}`);
//       await stopImpersonate(admin);
//       return true;
//     } catch (e) {
//       console.log(`  ✗ Upgraded failed: ${e.message?.substring(0, 100) || e}`);
//       return false;
//     }
//   } else {
//     console.log(`  ✗ EIP-1967 slots empty (admin=${admin}, impl=${impl})`);
//     return false;
//   }
// }

// ============================================================================
// Main Injection Runner
// ============================================================================

async function runInjection(target, tokenAbi, proxyAbi, signer0, options = {}) {
  const token = new hre.ethers.Contract(target, tokenAbi, signer0);
  let success = 0;
  let failed = 0;

  if (options.transfer) {
    if (await injectTransfer(token, target, signer0)) success++; else failed++;
  }

  if (options.mint) {
    if (await injectMint(token, target, tokenAbi, signer0)) success++; else failed++;
  }

  if (options.pause) {
    if (await injectPause(token, target, tokenAbi)) success++; else failed++;
  }

  if (options.upgraded) {
    if (await injectUpgraded(target, proxyAbi)) success++; else failed++;
  }

  return { success, failed };
}

async function main() {
  const isContinuous = process.argv.includes("continuous");
  const noReset = process.env.NO_RESET === "true";
  const target = hre.ethers.getAddress(process.env.TARGET_ADDRESS || DEFAULT_TARGET);
  const interval = parseInt(process.env.INTERVAL) || DEFAULT_INTERVAL;
  const count = parseInt(process.env.COUNT) || Infinity;

  // Injection options
  const envInjectTransfer = process.env.INJECT_TRANSFER === "true";
  const envInjectMint = process.env.INJECT_MINT === "true";
  const envInjectPause = process.env.INJECT_PAUSE === "true";
  const envInjectUpgraded = process.env.INJECT_UPGRADED === "true";

  console.log("=".repeat(70));
  console.log("XDC USDC Event Injection - Continuous Test Mode");
  console.log("=".repeat(70));
  console.log(`Mode: ${isContinuous ? "CONTINUOUS" : "SINGLE RUN"}`);
  console.log(`Reset fork before injection: ${!noReset}`);
  console.log(`Target: ${target}`);
  console.log(`Interval: ${interval}s`);
  console.log(`Count: ${count === Infinity ? "unlimited" : count}`);
  console.log(`Events to inject: ${[
    envInjectTransfer ? "Transfer" : "",
    envInjectMint ? "Mint" : "",
    envInjectPause ? "Pause" : "",
    envInjectUpgraded ? "Upgraded" : ""
  ].filter(x => x).join(", ") || "all"}`);
  console.log("=".repeat(70));

  // Load proxy ABI
  const proxyAbiPath = path.join(__dirname, "../../contracts/XDCS_USDC/usdcabi.json");
  const proxyAbi = JSON.parse(fs.readFileSync(proxyAbiPath, "utf8"));

  const [signer0] = await hre.ethers.getSigners();

  // Optional: Reset fork to get fresh state
  if (!noReset) {
    const upstream = process.env.XDC_RPC_URL || "https://rpc.ankr.com/xdc";
    console.log(`\nResetting fork from ${upstream}...`);
    await hre.network.provider.send("hardhat_reset", [
      {
        forking: { jsonRpcUrl: upstream }
      }
    ]);
    console.log(`✓ Fork reset complete`);
  } else {
    console.log(`\nSkipping fork reset (NO_RESET=true)`);
  }

  // Options: use env vars, or default to all events for single run
  const injectionOptions = {
    transfer: envInjectTransfer || !isContinuous,
    mint: envInjectMint || !isContinuous,
    pause: envInjectPause || !isContinuous,
    upgraded: envInjectUpgraded || !isContinuous
  };

  if (isContinuous) {
    console.log(`\n🚀 Starting continuous injection mode...`);
    console.log(`   Press Ctrl+C to stop`);
    console.log("");

    let injectionCount = 0;
    const startTime = Date.now();

    while (injectionCount < count) {
      injectionCount++;
      console.log(`\n${"=".repeat(50)}`);
      console.log(`Injection #${injectionCount}/${count === Infinity ? "∞" : count}`);
      console.log(`${"=".repeat(50)}`);

      const { success, failed } = await runInjection(target, MINIMAL_TOKEN_ABI, proxyAbi, signer0, injectionOptions);

      if (injectionCount < count) {
        console.log(`\n⏳ Waiting ${interval}s before next injection...`);
        await new Promise(resolve => setTimeout(resolve, interval * 1000));
      }
    }

    const totalTime = Math.round((Date.now() - startTime) / 1000);
    console.log(`\n${"=".repeat(70)}`);
    console.log(`✓ Completed ${injectionCount} injections in ${totalTime}s`);
    console.log("=".repeat(70));
  } else {
    // Single run mode
    console.log(`\n🚀 Running single injection...`);
    const { success, failed } = await runInjection(target, MINIMAL_TOKEN_ABI, proxyAbi, signer0, injectionOptions);
    console.log(`\nDone: ${success} success, ${failed} failed`);
  }

  console.log(`\nNetwork: ${hre.network.name}`);
  console.log(`Target: ${target}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

