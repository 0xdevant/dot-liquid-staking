import { ethers, waffle } from "hardhat";
import { BigNumber } from "ethers";
import { LiquidStaking, IERC20, IERC20Plus } from "../typechain";
import LIQUID_STAKING_ABI from "../abis/LiquidStaking.json";
import IERC20_PLUS_ABI from "../abis/IERC20Plus.json";
import ERC20_ABI from "../abis/ERC20.json";
import { Environment, SupportedChain, contractAddresses } from "../deployed";

async function main() {
  const chain = SupportedChain.ASTAR;
  const { LiquidStaking: address } = contractAddresses[Environment.DEV][chain];
  console.log(`Testing Liquid Staking on address: ${address}`);

  const accounts = await ethers.getSigners();
  const userBalance = ethers.utils.formatEther(await ethers.provider.getBalance(accounts[0].address));
  console.log(`Caller ${accounts[0].address} native token balance: ${userBalance}`);

  const contractBalance = ethers.utils.formatEther(await ethers.provider.getBalance(address));
  console.log(`Contract native token balance: ${contractBalance}`);

  const contract = new ethers.Contract(address, LIQUID_STAKING_ABI, accounts[0]) as LiquidStaking;
  const dotAddress = await contract.dot();
  console.log(`DOT Address: ${dotAddress}`);

  const dot = new ethers.Contract(dotAddress, IERC20_PLUS_ABI, accounts[0]) as IERC20Plus;
  const calletDotBalance = await dot.balanceOf(accounts[0].address);
  const dotDecimal = await dot.decimals();
  console.log(`Caller DOT balance: ${calletDotBalance.div(BigNumber.from(10).pow(dotDecimal))} DOT`);

  console.log(`Approving contract to spend 10 DOT from caller`);
  const txn1 = await dot.approve(address, 10 * 10 ** 10);
  await txn1.wait();
  console.log(`Approved`);
  console.log(txn1);

  console.log(`Caller stake 10 DOT to contract`);
  const txn2 = await contract.stake(10 * 10 ** 10);
  await txn2.wait();
  console.log(txn2);
}

main();