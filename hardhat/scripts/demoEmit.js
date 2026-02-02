const hre = require("hardhat");

/**
 * Inject mock code into the target address, then emit a few demo txs that will:
 * - match function signatures: upgradeTo / upgradeToAndCall
 * - emit events: Transfer / Mint / Pause / Paused / Upgraded
 *
 * Usage:
 *   npm run demo:emit
 *
 * Optional env:
 *   TARGET_ADDRESS=0xfa2958cb79b0491cc627c1557f441ef849ca8eb1
 */
async function main() {
  const target =
    process.env.TARGET_ADDRESS?.toLowerCase() ||
    "0xfa2958cb79b0491cc627c1557f441ef849ca8eb1";

  await hre.run("compile");

  const artifact = await hre.artifacts.readArtifact("XdcUsdcKeyActionsMock");
  if (!artifact.deployedBytecode || artifact.deployedBytecode === "0x") {
    throw new Error("Missing deployedBytecode for XdcUsdcKeyActionsMock");
  }

  // Overwrite code at target address on the forked chain
  await hre.network.provider.send("hardhat_setCode", [target, artifact.deployedBytecode]);

  const signer = (await hre.ethers.getSigners())[0];
  const c = await hre.ethers.getContractAt("XdcUsdcKeyActionsMock", target, signer);

  // Emit function-matched txs
  const tx1 = await c.upgradeTo("0x0000000000000000000000000000000000001111");
  await tx1.wait();

  const tx2 = await c.upgradeToAndCall("0x0000000000000000000000000000000000002222", "0x", {
    value: 0n
  });
  await tx2.wait();

  // Emit a batch of events
  const tx3 = await c.demoEmit({ value: 0n });
  await tx3.wait();

  console.log(`Injected mock at ${target} and emitted demo txs on network: ${hre.network.name}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});


