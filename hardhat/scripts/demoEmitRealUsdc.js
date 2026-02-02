const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * Real-mode demo:
 * - DOES NOT change bytecode at TARGET_ADDRESS (no hardhat_setCode)
 * - Calls the real (forked) contract at TARGET_ADDRESS to trigger events
 *
 * What we can do without any privileged keys:
 * - Emit a real ERC20 Transfer event by calling transfer(..., 0)
 *
 * What we can do with fork-only superpowers (still keeps contract bytecode identical):
 * - Impersonate the proxy admin (read from EIP-1967 admin slot) and call upgradeTo(currentImplementation)
 *   to emit Upgraded(address) WITHOUT changing implementation (it stays the same).
 *
 * Optional (requires you to provide role addresses, and requires those functions to exist):
 * - PAUSER_ADDRESS=0x... to try calling pause()
 * - MINTER_ADDRESS=0x... to try calling mint(to, amount)
 *
 * Usage:
 *   npm run demo:emit:real
 *
 * Env:
 *   TARGET_ADDRESS=0xfa2958cb79b0491cc627c1557f441ef849ca8eb1
 *   RESET_FORK=1                  # (recommended) wipe local state back to a clean fork
 *   XDC_RPC_URL=https://rpc.ankr.com/xdc
 *   PAUSER_ADDRESS=0x...
 *   MINTER_ADDRESS=0x...
 */

const DEFAULT_TARGET = "0xfa2958cb79b0491cc627c1557f441ef849ca8eb1";

// EIP-1967 slots:
// bytes32(uint256(keccak256('eip1967.proxy.admin')) - 1)
const EIP1967_ADMIN_SLOT =
  "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";
// bytes32(uint256(keccak256('eip1967.proxy.implementation')) - 1)
const EIP1967_IMPL_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

function storageWordToAddress(word) {
  // word is 0x + 64 hex chars. Address is last 40 hex chars.
  if (!word || typeof word !== "string" || !word.startsWith("0x") || word.length !== 66) {
    return null;
  }
  const addrHex = "0x" + word.slice(26); // 2 + (64-40) = 26
  return hre.ethers.getAddress(addrHex);
}

async function setBalance(address) {
  // Give 1e20 wei so the impersonated account can pay gas on fork
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
  const target = hre.ethers.getAddress(process.env.TARGET_ADDRESS || DEFAULT_TARGET);

  // If you previously used the "inject" demo (hardhat_setCode), your local fork no longer matches mainnet.
  // Resetting restores the forked state (code + storage) from the upstream RPC.
  if (process.env.RESET_FORK === "1") {
    const upstream = process.env.XDC_RPC_URL || "https://rpc.ankr.com/xdc";
    await hre.network.provider.send("hardhat_reset", [
      {
        forking: { jsonRpcUrl: upstream }
      }
    ]);
    console.log(`[real] hardhat_reset done (forking from ${upstream})`);
  }

  // Load proxy ABI (you provided usdcabi.json)
  const proxyAbiPath = path.join(__dirname, "../../contracts/XDCS_USDC/usdcabi.json");
  const proxyAbi = JSON.parse(fs.readFileSync(proxyAbiPath, "utf8"));

  // Minimal token ABI (for Transfer simulation)
  const tokenAbi = [
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
    }
  ];

  const [signer0] = await hre.ethers.getSigners();

  // 1) Real Transfer event (transfer 0 to self is typically allowed; no USDC balance needed)
  const token = new hre.ethers.Contract(target, tokenAbi, signer0);
  const txT = await token.transfer(signer0.address, 0n);
  await txT.wait();
  console.log(`[real] Transfer emitted via real contract at ${target}, tx=${txT.hash}`);

  // 2) Real Upgraded event (no bytecode change): read admin + implementation from EIP-1967 slots
  const adminWord = await hre.ethers.provider.getStorage(target, EIP1967_ADMIN_SLOT);
  const implWord = await hre.ethers.provider.getStorage(target, EIP1967_IMPL_SLOT);
  const admin = storageWordToAddress(adminWord);
  const impl = storageWordToAddress(implWord);

  if (admin && impl) {
    console.log(`[real] EIP-1967 slots decoded: admin=${admin}, impl=${impl}`);

    try {
      const adminSigner = await impersonate(admin);
      const proxy = new hre.ethers.Contract(target, proxyAbi, adminSigner);

      // upgradeTo(currentImplementation) *might* emit Upgraded(...) while keeping implementation unchanged.
      // Some deployments are not OZ Transparent proxies / not EIP-1967, or upgradeTo is access-controlled differently.
      const txU = await proxy.upgradeTo(impl);
      await txU.wait();
      console.log(`[real] Upgraded emitted (best-effort), tx=${txU.hash}`);
      await stopImpersonate(admin);
    } catch (e) {
      console.log(
        `[real] upgradeTo(...) attempt failed (this may mean the target isn't an EIP-1967 OZ proxy, or admin/ABI is different): ${e.message || e}`
      );
    }
  } else {
    console.log(`[real] Skip Upgraded: EIP-1967 admin/impl slots look empty on this target`);
  }

  // 3) Optional: pause/mint with user-provided role addresses
  const pauser = process.env.PAUSER_ADDRESS ? hre.ethers.getAddress(process.env.PAUSER_ADDRESS) : null;
  const minter = process.env.MINTER_ADDRESS ? hre.ethers.getAddress(process.env.MINTER_ADDRESS) : null;

  if (pauser) {
    const pauserSigner = await impersonate(pauser);
    const tokenAsPauser = new hre.ethers.Contract(target, tokenAbi, pauserSigner);
    try {
      const txP = await tokenAsPauser.pause();
      await txP.wait();
      console.log(`[real] pause() sent from ${pauser}, tx=${txP.hash}`);
    } catch (e) {
      console.log(`[real] pause() failed (need correct role / function may not exist): ${e.message || e}`);
    } finally {
      await stopImpersonate(pauser);
    }
  }

  if (minter) {
    const minterSigner = await impersonate(minter);
    const tokenAsMinter = new hre.ethers.Contract(target, tokenAbi, minterSigner);
    try {
      const txM = await tokenAsMinter.mint(signer0.address, 1n);
      await txM.wait();
      console.log(`[real] mint() sent from ${minter}, tx=${txM.hash}`);
    } catch (e) {
      console.log(`[real] mint() failed (need correct role / function may not exist): ${e.message || e}`);
    } finally {
      await stopImpersonate(minter);
    }
  }

  console.log(`[real] Done on network=${hre.network.name}, target=${target}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});


