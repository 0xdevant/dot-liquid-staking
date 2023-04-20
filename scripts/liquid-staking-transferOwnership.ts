import { ethers, waffle } from "hardhat";
import { LiquidStaking, Timelock, IERC20, IERC20Plus } from "../typechain";
import LIQUID_STAKING_ABI from "../abis/LiquidStaking.json";
import IERC20_PLUS_ABI from "../abis/IERC20Plus.json";
import { Environment, SupportedChain, contractAddresses } from "../deployed";

async function main() {
  const chain = SupportedChain.ASTAR;
  const { LiquidStaking: liquidStakingAddress, Timelock: timeLockAddress } = contractAddresses[Environment.DEV][chain];
  console.log(`Testing Liquid Staking on address: ${liquidStakingAddress}, Timelock on address ${timeLockAddress}`);

  const [caller] = await ethers.getSigners();

  const userBalance = ethers.utils.formatEther(await ethers.provider.getBalance(caller.address));
  console.log(`Caller ${caller.address} native token balance: ${userBalance}`);

  const contractBalance = ethers.utils.formatEther(await ethers.provider.getBalance(liquidStakingAddress));
  console.log(`Contract native token balance: ${contractBalance}`);

  const contract = new ethers.Contract(liquidStakingAddress, LIQUID_STAKING_ABI, caller) as LiquidStaking;

  console.log(`Contract owner Address: ${await contract.owner()}`);

  console.log(`Operator address: ${await contract.operator()}`);

  const dotAddress = await contract.dot();
  console.log(`DOT Address: ${dotAddress}`);

  const dot = new ethers.Contract(dotAddress, IERC20_PLUS_ABI, caller) as IERC20Plus;
  const calletDotBalance = await dot.balanceOf(caller.address);
  const dotDecimal = await dot.decimals();
  console.log(`Caller DOT balance: ${ethers.utils.formatUnits(calletDotBalance, dotDecimal)} DOT`);

  console.log("transferring ownership to Timelock contract...");
  const txn1 = await contract.connect(caller).transferOwnership(timeLockAddress);
  await txn1.wait();
  console.log(txn1);
  console.log(`Transferred !`);
}

main();