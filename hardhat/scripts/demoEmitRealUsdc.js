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

function topicToAddress(topic) {
  // topic is 0x + 64 hex chars, address is last 40 chars
  if (!topic || typeof topic !== "string" || !topic.startsWith("0x") || topic.length !== 66) {
    return null;
  }
  return hre.ethers.getAddress("0x" + topic.slice(26));
}

async function tryCall(contract, fn, args = []) {
  try {
    return await contract[fn](...args);
  } catch (e) {
    return null;
  }
}

async function main() {
  const target = hre.ethers.getAddress(process.env.TARGET_ADDRESS || DEFAULT_TARGET);

  // If you previously used the "inject" demo (hardhat_setCode), your local fork no longer matches mainnet.
  // Resetting restores the forked state (code + storage) from the upstream RPC.
    const upstream = process.env.XDC_RPC_URL || "https://rpc.ankr.com/xdc";
    await hre.network.provider.send("hardhat_reset", [
      {
        forking: { jsonRpcUrl: upstream }
      }
    ]);
    console.log(`hardhat_reset done (forking from ${upstream})`);
  

  // Load proxy ABI (you provided usdcabi.json)
  const proxyAbiPath = path.join(__dirname, "../../contracts/XDCS_USDC/usdcabi.json");
  const proxyAbi = JSON.parse(fs.readFileSync(proxyAbiPath, "utf8"));

  // Minimal token ABI (for real event simulation)
  // NOTE: Not every token/proxy will implement all of these; we probe and fall back.
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
    },
    // USDC-style role getters / config (best-effort)
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
    },
    {
      type: "function",
      name: "minterAllowance",
      stateMutability: "view",
      inputs: [{ name: "minter", type: "address" }],
      outputs: [{ name: "", type: "uint256" }]
    }
  ];

  const [signer0] = await hre.ethers.getSigners();

  // 1) Try to emit a real Transfer event.
  // Some tokens may not emit Transfer on a 0-value transfer; if that happens, a successful mint below will emit Transfer(0x0 -> to) anyway.
  const token = new hre.ethers.Contract(target, tokenAbi, signer0);
  try {
    const txT = await token.transfer(signer0.address, 0n);
    const rT = await txT.wait();
    console.log(
      `transfer(0) sent to emit Transfer (best-effort), block=${rT.blockNumber}, tx=${txT.hash}`
    );
  } catch (e) {
    console.log(`transfer(0) failed or didn't emit (will rely on mint if possible): ${e.message || e}`);
  }

  // 2) Try to emit Mint (+ likely Transfer) using the REAL contract.
  // Priority:
  //   - MINTER_ADDRESS env (impersonate that address and call mint)
  //   - configure signer0 as minter via masterMinter (if supported) then mint from signer0
  //   - discover a minter from recent Mint logs and impersonate it
  const mintTopic0 = hre.ethers.id("Mint(address,address,uint256)");
  const minterEnv = process.env.MINTER_ADDRESS ? hre.ethers.getAddress(process.env.MINTER_ADDRESS) : null;

  const tryMintAs = async (minterAddr) => {
    const minterSigner = await impersonate(minterAddr);
    const tokenAsMinter = new hre.ethers.Contract(target, tokenAbi, minterSigner);
    try {
      const txM = await tokenAsMinter.mint(signer0.address, 1n);
      await txM.wait();
      console.log(`mint() sent from minter=${minterAddr}, tx=${txM.hash}`);
      return true;
    } catch (e) {
      console.log(`mint() failed from minter=${minterAddr}: ${e.message || e}`);
      return false;
    } finally {
      await stopImpersonate(minterAddr);
    }
  };

  let minted = false;
  if (minterEnv) {
    minted = await tryMintAs(minterEnv);
  }

  if (!minted) {
    // Try configureMinter via masterMinter (USDC-style)
    const mm = await tryCall(token, "masterMinter");
    const masterMinter = mm ? hre.ethers.getAddress(mm) : null;
    if (masterMinter) {
      const masterSigner = await impersonate(masterMinter);
      const tokenAsMaster = new hre.ethers.Contract(target, tokenAbi, masterSigner);
      try {
        const txC = await tokenAsMaster.configureMinter(signer0.address, 1000000n);
        const rC = await txC.wait();
        console.log(
          `configureMinter(signer0, 1000000) sent from masterMinter=${masterMinter}, block=${rC.blockNumber}, tx=${txC.hash}`
        );
      } catch (e) {
        console.log(`configureMinter failed (maybe not USDC-style / wrong role): ${e.message || e}`);
      } finally {
        await stopImpersonate(masterMinter);
      }

      try {
        const txM2 = await token.mint(signer0.address, 1n);
        const rM2 = await txM2.wait();
        console.log(
          `mint() sent from signer0 (after configureMinter attempt), block=${rM2.blockNumber}, tx=${txM2.hash}`
        );
        minted = true;
      } catch (e) {
        console.log(`mint() from signer0 failed (still not a minter): ${e.message || e}`);
      }
    }
  }

  if (!minted) {
    // Try discovering a minter address from recent Mint logs
    const latest = await hre.ethers.provider.getBlockNumber();
    const searchBlocks = BigInt(process.env.MINT_SEARCH_BLOCKS || "5000");
    const from = latest > Number(searchBlocks) ? latest - Number(searchBlocks) : 0;
    try {
      const logs = await hre.ethers.provider.getLogs({
        address: target,
        fromBlock: from,
        toBlock: latest,
        topics: [mintTopic0]
      });
      const first = logs[0];
      const discovered = first?.topics?.[1] ? topicToAddress(first.topics[1]) : null;
      if (discovered) {
        console.log(`discovered recent minter from Mint logs: ${discovered} (search ${from}..${latest})`);
        minted = await tryMintAs(discovered);
      } else {
        console.log(`no Mint logs found in last ${searchBlocks.toString()} blocks; cannot auto-discover a minter`);
      }
    } catch (e) {
      console.log(`Mint log search failed: ${e.message || e}`);
    }
  }

  // 3) Try to emit Pause/Paused using a REAL pauser (env > onchain getter)
  const pauserEnv = process.env.PAUSER_ADDRESS ? hre.ethers.getAddress(process.env.PAUSER_ADDRESS) : null;
  let pauserAddr = pauserEnv;
  if (!pauserAddr) {
    const p = await tryCall(token, "pauser");
    pauserAddr = p ? hre.ethers.getAddress(p) : null;
  }
  if (pauserAddr) {
    const pauserSigner = await impersonate(pauserAddr);
    const tokenAsPauser = new hre.ethers.Contract(target, tokenAbi, pauserSigner);
    try {
      const txP = await tokenAsPauser.pause();
      const rP = await txP.wait();
      console.log(`pause() sent from pauser=${pauserAddr}, block=${rP.blockNumber}, tx=${txP.hash}`);
    } catch (e) {
      console.log(`pause() failed from pauser=${pauserAddr}: ${e.message || e}`);
    } finally {
      await stopImpersonate(pauserAddr);
    }
  } else {
    console.log(`Skip pause(): no PAUSER_ADDRESS provided and pauser() getter not available`);
  }

  // 4) Try to emit Upgraded (best-effort): this depends on the target being upgradeable + correct admin/ABI.
  const adminWord = await hre.ethers.provider.getStorage(target, EIP1967_ADMIN_SLOT);
  const implWord = await hre.ethers.provider.getStorage(target, EIP1967_IMPL_SLOT);
  const admin = storageWordToAddress(adminWord);
  const impl = storageWordToAddress(implWord);

  // IMPORTANT: if admin/impl decode to the zero address, DO NOT attempt impersonation,
  // otherwise you'll create confusing "from=0x0" transactions that may match your monitor.
  if (admin && impl && admin !== hre.ethers.ZeroAddress && impl !== hre.ethers.ZeroAddress) {
    console.log(`EIP-1967 slots decoded: admin=${admin}, impl=${impl}`);

    try {
      const adminSigner = await impersonate(admin);
      const proxy = new hre.ethers.Contract(target, proxyAbi, adminSigner);

      // upgradeTo(currentImplementation) *might* emit Upgraded(...) while keeping implementation unchanged.
      // Some deployments are not OZ Transparent proxies / not EIP-1967, or upgradeTo is access-controlled differently.
      const txU = await proxy.upgradeTo(impl);
      await txU.wait();
      console.log(`Upgraded emitted (best-effort), tx=${txU.hash}`);
      await stopImpersonate(admin);
    } catch (e) {
      console.log(
        `upgradeTo(...) attempt failed (this may mean the target isn't an EIP-1967 OZ proxy, or admin/ABI is different): ${e.message || e}`
      );
    }
  } else {
    console.log(`Skip Upgraded: EIP-1967 admin/impl slots look empty on this target`);
  }

  console.log(`Done on network=${hre.network.name}, target=${target}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});


