import { ethers } from "hardhat";

const { BigNumber } = ethers;

export async function advanceBlock() {
  return ethers.provider.send("evm_mine", []);
}

export async function advanceBlockTo(blockNumber) {
  for (let i = await ethers.provider.getBlockNumber(); i < blockNumber; i++) {
    await advanceBlock();
  }
}

export async function increase(value) {
  await ethers.provider.send("evm_increaseTime", [value.toNumber()]);
  await advanceBlock();
}

export async function latest() {
  const block = await ethers.provider.getBlock("latest");
  return BigNumber.from(block.timestamp);
}

export async function advanceTimeAndBlock(time) {
  await advanceTime(time);
  await advanceBlock();
}

export async function advanceTime(time) {
  await ethers.provider.send("evm_increaseTime", [time]);
}

export const duration = {
  seconds(val) {
    return BigNumber.from(val);
  },
  minutes(val) {
    return BigNumber.from(val).mul(this.seconds("60"));
  },
  hours(val) {
    return BigNumber.from(val).mul(this.minutes("60"));
  },
  days(val) {
    return BigNumber.from(val).mul(this.hours("24"));
  },
  weeks(val) {
    return BigNumber.from(val).mul(this.days("7"));
  },
  years(val) {
    return BigNumber.from(val).mul(this.days("365"));
  },
};

export async function incrementCurrentTimeAndGet() {
  advanceTimeAndBlock(1);
  return latest();
}