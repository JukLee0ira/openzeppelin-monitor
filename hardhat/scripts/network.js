/**
 * 统一的网络连接配置
 * 
 * 所有脚本使用此文件来获取 provider、signer 和执行网络操作
 * 这样可以集中管理网络配置，避免代码重复
 * 
 * 使用方法:
 *   const { getProvider, getSigners, resetFork, ... } = require("./network");
 *   
 *   const provider = getProvider();
 *   const signers = await getSigners();
 */

const hre = require("hardhat");

// 默认 RPC URL (XDC Mainnet)
const DEFAULT_XDC_RPC_URL = "https://rpc.ankr.com/xdc";

/**
 * 获取 RPC URL
 * 优先级: 环境变量 XDC_RPC_URL > hardhat.config.js 配置
 */
function getRpcUrl() {
  return process.env.XDC_RPC_URL || DEFAULT_XDC_RPC_URL;
}

/**
 * 获取 ethers provider
 * 用于读取区块链数据
 */
function getProvider() {
  return hre.ethers.provider;
}

/**
 * 获取 Hardhat 网络 provider (包含高级操作)
 * 用于 hardhat_reset, impersonateAccount 等
 */
function getNetworkProvider() {
  return hre.network.provider;
}

/**
 * 获取签名者列表
 */
async function getSigners() {
  return await hre.ethers.getSigners();
}

/**
 * 获取单个签名者
 * @param {number} index - 签名者索引 (默认 0)
 */
async function getSigner(index = 0) {
  const signers = await getSigners();
  return signers[index];
}

/**
 * 获取网络名称
 */
function getNetworkName() {
  return hre.network.name;
}

/**
 * 检查是否是本地网络 (localhost 或 hardhat)
 */
function isLocalNetwork() {
  const name = getNetworkName();
  return name === "localhost" || name === "hardhat";
}

/**
 * 重置 fork
 * @param {string} rpcUrl - 要 fork 的 RPC URL (可选，默认使用 XDC Mainnet)
 * @param {number} blockNumber - 要 fork 的区块号 (可选，默认 latest)
 */
async function resetFork(rpcUrl = null, blockNumber = null) {
  const url = rpcUrl || getRpcUrl();
  const config = {
    forking: {
      jsonRpcUrl: url
    }
  };
  
  if (blockNumber !== null) {
    config.forking.blockNumber = blockNumber;
  }
  
  await hre.network.provider.send("hardhat_reset", [config]);
}

/**
 * 设置账户余额
 * @param {string} address - 账户地址
 * @param {string} balance - 余额 (十六进制字符串，如 "0x56BC75E2D63100000")
 */
async function setBalance(address, balance = "0x56BC75E2D63100000") {
  await hre.network.provider.send("hardhat_setBalance", [address, balance]);
}

/**
 * 模拟账户 (impersonate)
 * @param {string} address - 要模拟的账户地址
 * @param {string} initialBalance - 初始余额 (可选)
 */
async function impersonateAccount(address, initialBalance = "0x56BC75E2D63100000") {
  await hre.network.provider.send("hardhat_impersonateAccount", [address]);
  await setBalance(address, initialBalance);
  return await hre.ethers.getSigner(address);
}

/**
 * 停止模拟账户
 * @param {string} address - 停止模拟的账户地址
 */
async function stopImpersonating(address) {
  await hre.network.provider.send("hardhat_stopImpersonatingAccount", [address]);
}

/**
 * 创建合约实例
 * @param {string} address - 合约地址
 * @param {Array} abi - 合约 ABI
 * @param {object} signerOrProvider - 签名者或 provider (可选，默认使用第一个签名者)
 */
function getContract(address, abi, signerOrProvider = null) {
  const runner = signerOrProvider || hre.ethers.getSigners().then(signers => signers[0]);
  
  // 如果传入的是 signer，直接使用
  if (signerOrProvider) {
    return new hre.ethers.Contract(address, abi, signerOrProvider);
  }
  
  // 否则返回 Promise
  return hre.ethers.getSigners().then(signers => 
    new hre.ethers.Contract(address, abi, signers[0])
  );
}

/**
 * 创建合约实例 (带签名者)
 * @param {string} address - 合约地址
 * @param {object} signer - 签名者
 * @param {Array} abi - 合约 ABI
 */
function getContractWithSigner(address, signer, abi) {
  return new hre.ethers.Contract(address, abi, signer);
}

module.exports = {
  getRpcUrl,
  getProvider,
  getNetworkProvider,
  getSigners,
  getSigner,
  getNetworkName,
  isLocalNetwork,
  resetFork,
  setBalance,
  impersonateAccount,
  stopImpersonating,
  getContract,
  getContractWithSigner,
  DEFAULT_XDC_RPC_URL
};



