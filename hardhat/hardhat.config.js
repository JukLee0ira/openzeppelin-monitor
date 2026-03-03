require("@nomicfoundation/hardhat-toolbox");

const XDC_RPC_URL = process.env.XDC_RPC_URL || "https://rpc.ankr.com/xdc";

/** @type import("hardhat/config").HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 }
    }
  },
  networks: {
    /**
     * This is the in-memory Hardhat Network. We configure it to FORK XDC mainnet
     * and to use XDC's chainId (50) so tools that expect mainnet chainId behave.
     */
    hardhat: {
      chainId: 50,
      hardfork: "cancun",  // Use latest hardfork to avoid historical block issues
      forking: {
        url: XDC_RPC_URL,
        blockNumber: undefined  // Fork from latest block by default
      }
    },
    /**
     * When you run `npm run node`, Hardhat exposes a JSON-RPC endpoint.
     * In scripts, use `--network localhost` to hit that endpoint.
     */
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 50
    }
  }
};


