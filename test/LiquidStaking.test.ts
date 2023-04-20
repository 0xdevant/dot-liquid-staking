import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { BigNumber } from "ethers";
import { ethers, network, upgrades } from "hardhat";
import { LiquidStaking, MockXC20UpgradeableContract, MockERC20UpgradeableContract } from "typechain";
import { constants, time } from "@openzeppelin/test-helpers";
import { getBlockDateTime, setNextMineTimestamp } from "../../helpers/timeTravel";

const { ZERO_BYTES32 } = constants;

const HOLDER_AMOUNT = ethers.utils.parseUnits("10000", 10);
const WASTR_REWARD_AMOUNT = ethers.utils.parseEther("13333333");
const REWARD_AMOUNT = ethers.utils.parseEther("100000");

const MINDELAY = time.duration.days(2).toNumber(); // 48 hours

const salt = "0x025e7b0be353a74631ad648c667493c0e1cd31caa4cc2d3520fdc171ea0cc726"; // a random value

function genOperation(target, value, data, predecessor, salt) {
  const id = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["address", "uint256", "bytes", "uint256", "bytes32"],
      [target, value, data, predecessor, salt],
    ),
  );
  return { id, target, value, data, predecessor, salt };
}

async function calculateReward(userSDotBalance: number, totalReward: number): Promise<BigNumber> {
  const totalSDotIssuance = await liquidStaking.totalSupply();
  const share = userSDotBalance / totalSDotIssuance.toNumber();
  return ethers.utils.parseEther((totalReward * share).toString());
}

let dot: MockXC20UpgradeableContract;
// let sdot: MockERC20UpgradeableContract;
let wastr: MockERC20UpgradeableContract;
let rewardTokenExample: MockERC20UpgradeableContract;
let timelock: Timelock;
let liquidStaking: LiquidStaking;
let contractOwner: SignerWithAddress;
let feeCollector: SignerWithAddress;
let operator: SignerWithAddress;
let aliceUser: SignerWithAddress;
let bobUser: SignerWithAddress;
let carolUser: SignerWithAddress;
let maryUser: SignerWithAddress;
let randomUser: SignerWithAddress;
let proposerAndExecutor: SignerWithAddress;
let start: number;
const withdrawPendingBondABI = ["function withdrawPendingBond()"];
const withdrawPendingBondiface = new ethers.utils.Interface(withdrawPendingBondABI);
let withdrawPendingBondOperation;
let pauseOperation;

describe("LiquidStaking", function () {
  async function deployContractFixture() {
    const baseTime = await getBlockDateTime(ethers.provider);
    start = baseTime.plus({ days: 1 }).toSeconds();

    [contractOwner, feeCollector, operator, aliceUser, bobUser, carolUser, maryUser, randomUser, proposerAndExecutor] =
      await ethers.getSigners();

    const DOT = await ethers.getContractFactory("MockXC20UpgradeableContract");
    const WASTR = await ethers.getContractFactory("MockERC20UpgradeableContract");
    const RewardTokenExample = await ethers.getContractFactory("MockERC20UpgradeableContract");
    const LiquidStaking = await ethers.getContractFactory("LiquidStaking");
    const Timelock = await ethers.getContractFactory("Timelock");

    dot = (await upgrades.deployProxy(DOT, ["DOT", "DOT"])) as MockXC20UpgradeableContract;
    wastr = (await upgrades.deployProxy(WASTR, ["WASTR", "wASTR"])) as MockERC20UpgradeableContract;
    rewardTokenExample = (await upgrades.deployProxy(RewardTokenExample, [
      "RewardTokenExample",
      "RTE",
    ])) as MockERC20UpgradeableContract;

    liquidStaking = (await upgrades.deployProxy(LiquidStaking, [
      wastr.address,
      dot.address,
      feeCollector.address,
      operator.address,
    ])) as LiquidStaking;

    timelock = (await upgrades.deployProxy(Timelock, [
      MINDELAY,
      [proposerAndExecutor.address],
      [proposerAndExecutor.address],
      contractOwner.address,
    ])) as Timelock;

    // make Timelock contract as the owner of LiquidStaking contract to enforce a timelock on all `onlyOwner` functions
    await liquidStaking.transferOwnership(timelock.address);

    await dot.deployed();
    await dot.mint(aliceUser.address, HOLDER_AMOUNT);
    await dot.mint(bobUser.address, HOLDER_AMOUNT);
    await dot.mint(carolUser.address, HOLDER_AMOUNT);
    await dot.mint(maryUser.address, HOLDER_AMOUNT);
    await dot.mint(randomUser.address, HOLDER_AMOUNT);
    // await dot.mint(proposerAndExecutor.address, HOLDER_AMOUNT);

    await wastr.deployed();
    await wastr.mint(contractOwner.address, WASTR_REWARD_AMOUNT);
    await rewardTokenExample.deployed();
    await rewardTokenExample.mint(contractOwner.address, REWARD_AMOUNT);

    await dot.connect(aliceUser).approve(liquidStaking.address, ethers.utils.parseUnits("10000000", 10));
    await dot.connect(bobUser).approve(liquidStaking.address, ethers.utils.parseUnits("10000000", 10));
    await dot.connect(carolUser).approve(liquidStaking.address, ethers.utils.parseUnits("10000000", 10));
    await dot.connect(maryUser).approve(liquidStaking.address, ethers.utils.parseUnits("10000000", 10));
    await dot.connect(randomUser).approve(liquidStaking.address, ethers.utils.parseUnits("10000000", 10));
    await dot.connect(operator).approve(liquidStaking.address, ethers.utils.parseUnits("10000000", 10));
    await dot.connect(proposerAndExecutor).approve(liquidStaking.address, ethers.utils.parseUnits("10000000", 10));

    return {
      start,
      contractOwner,
      feeCollector,
      operator,
      aliceUser,
      bobUser,
      carolUser,
      maryUser,
      randomUser,
      proposerAndExecutor,
      wastr,
      rewardTokenExample,
      dot,
      liquidStaking,
      timelock,
    };
  }

  describe("Deployment", function () {
    it("should initialize data correctly", async () => {
      const { liquidStaking, feeCollector, wastr } = await loadFixture(deployContractFixture);

      expect(await liquidStaking.feeCollector()).to.equal(feeCollector.address);
      // expect(await liquidStaking.operator()).to.equal(operator.address);
      expect(await liquidStaking.isRewardToken(wastr.address)).to.equal(true);
    });
    it("should not let operator to withdraw DOT from contract while no one is staking", async () => {
      const { timelock, proposerAndExecutor, start } = await loadFixture(deployContractFixture);

      withdrawPendingBondOperation = genOperation(
        liquidStaking.address,
        0,
        withdrawPendingBondiface.encodeFunctionData("withdrawPendingBond"),
        ZERO_BYTES32,
        salt,
      );

      // activiate timelock
      await timelock
        .connect(proposerAndExecutor)
        .schedule(
          withdrawPendingBondOperation.target,
          withdrawPendingBondOperation.value,
          withdrawPendingBondOperation.data,
          withdrawPendingBondOperation.predecessor,
          withdrawPendingBondOperation.salt,
          MINDELAY,
        );
      // wait for 2 days
      await setNextMineTimestamp(start + 2 * 24 * 60 * 60);

      // Originally reverted with NoUserStaking
      await expect(
        timelock
          .connect(proposerAndExecutor)
          .execute(
            withdrawPendingBondOperation.target,
            withdrawPendingBondOperation.value,
            withdrawPendingBondOperation.data,
            withdrawPendingBondOperation.predecessor,
            withdrawPendingBondOperation.salt,
          ),
      ).to.be.revertedWith("TimelockController: underlying transaction reverted");
      // await expect(liquidStaking.connect(proposerAndExecutor).withdrawPendingBond()).to.be.revertedWith("NoUserStaking");
    });
  });

  describe("Three users stake before the first round of bonding by operator", function () {
    /**
     * @notice Initial setup
     * 1. Alice stake - 500 DOT => 499.965 DOT after deducting fee, ~50% share
     * 2. Bob stake - 300 DOT => 299.965 DOT after deducting fee, ~30% share
     * 3. Carol stake - 200 DOT, 199.965 DOT after deducting fee, ~20% share
     */
    this.beforeEach(async () => {
      const {
        liquidStaking,
        timelock,
        aliceUser,
        bobUser,
        carolUser,
        randomUser,
        contractOwner,
        proposerAndExecutor,
        wastr,
        dot,
        start,
      } = await loadFixture(deployContractFixture);

      await liquidStaking.connect(aliceUser).stake(ethers.utils.parseUnits("500", 10));
      await liquidStaking.connect(bobUser).stake(ethers.utils.parseUnits("300", 10));
      await liquidStaking.connect(carolUser).stake(ethers.utils.parseUnits("200", 10));

      // 1,111,111 WASTR rewards to be distributed every month, so ~37000 WASTR will be injected into contract everyday
      await wastr.connect(contractOwner).transfer(liquidStaking.address, ethers.utils.parseEther("37000"));
      await liquidStaking.updateReward(wastr.address);

      withdrawPendingBondOperation = genOperation(
        liquidStaking.address,
        0,
        withdrawPendingBondiface.encodeFunctionData("withdrawPendingBond"),
        ZERO_BYTES32,
        salt,
      );

      return {
        liquidStaking,
        timelock,
        contractOwner,
        feeCollector,
        // operator,
        aliceUser,
        bobUser,
        carolUser,
        randomUser,
        proposerAndExecutor,
        wastr,
        dot,
        start,
        withdrawPendingBondOperation,
      };
    });

    it("should update internalDotBalance and totalPendingBondAmount, and mint sDOT", async () => {
      expect(await dot.balanceOf(liquidStaking.address)).to.equal(ethers.utils.parseUnits("999.895", 10));
      expect(await liquidStaking.internalDotBalance()).to.equal(ethers.utils.parseUnits("999.895", 10));
      expect(await liquidStaking.totalPendingBondAmount()).to.equal(ethers.utils.parseUnits("999.895", 10));
      expect(await liquidStaking.balanceOf(aliceUser.address)).to.be.equal(ethers.utils.parseUnits("499.965", 10));
      expect(await liquidStaking.balanceOf(bobUser.address)).to.be.equal(ethers.utils.parseUnits("299.965", 10));
      expect(await liquidStaking.balanceOf(carolUser.address)).to.be.equal(ethers.utils.parseUnits("199.965", 10));
    });

    describe("[Operator no withdrawl or deposit] One user stake and then unstake", function () {
      it("should let staker unstake instantly if operator hasn't withdrawn bond DOTs yet", async () => {
        // bob decides to unstake part of his staked DOT
        await liquidStaking.connect(bobUser).unstake(ethers.utils.parseUnits("150", 10));
        // bob's DOT balance should be (9700 + 150)
        expect(await dot.balanceOf(bobUser.address)).to.equal(ethers.utils.parseUnits("9850", 10));
      });
    });

    describe("[Operator withdrawed pending bond DOTs] One staker tries to unstake and claim DOT, one staker harvests reward", function () {
      it("should let only operator to withdraw DOT from contract when totalPendingBondAmount > 0", async () => {
        // activiate timelock
        await timelock
          .connect(proposerAndExecutor)
          .schedule(
            withdrawPendingBondOperation.target,
            withdrawPendingBondOperation.value,
            withdrawPendingBondOperation.data,
            withdrawPendingBondOperation.predecessor,
            withdrawPendingBondOperation.salt,
            MINDELAY,
          );
        // wait for 2 days
        await setNextMineTimestamp(start + 2 * 24 * 60 * 60);

        // Originally reverted with NotAuthorizedToWithdraw
        await expect(
          timelock
            .connect(randomUser)
            .execute(
              withdrawPendingBondOperation.target,
              withdrawPendingBondOperation.value,
              withdrawPendingBondOperation.data,
              withdrawPendingBondOperation.predecessor,
              withdrawPendingBondOperation.salt,
            ),
        ).to.be.reverted;
      });
      it("should accrue WASTR reward according to the share of each user", async () => {
        /**
         * @notice 1st round reward
         * 1. ~37000 WASTR distributed
         * 2. Alice share reward - 18500 WASTR
         * 3. Bob share reward - 11100 WASTR
         * 4. Carol share reward - 7400 WASTR
         */
        expect(await liquidStaking.getPendingReward(aliceUser.address, wastr.address)).to.be.closeTo(
          await calculateReward((await liquidStaking.balanceOf(aliceUser.address)).toNumber(), 37000),
          ethers.utils.parseEther("0.0001"),
        );
        expect(await liquidStaking.getPendingReward(bobUser.address, wastr.address)).to.be.closeTo(
          await calculateReward((await liquidStaking.balanceOf(bobUser.address)).toNumber(), 37000),
          ethers.utils.parseEther("0.0001"),
        );
        expect(await liquidStaking.getPendingReward(carolUser.address, wastr.address)).to.be.closeTo(
          await calculateReward((await liquidStaking.balanceOf(carolUser.address)).toNumber(), 37000),
          ethers.utils.parseEther("0.0001"),
        );
      });

      it("should let user unstake, but not claim DOT instantly if operator has just withdrawn bond DOTs", async () => {
        // activiate timelock
        await timelock
          .connect(proposerAndExecutor)
          .schedule(
            withdrawPendingBondOperation.target,
            withdrawPendingBondOperation.value,
            withdrawPendingBondOperation.data,
            withdrawPendingBondOperation.predecessor,
            withdrawPendingBondOperation.salt,
            MINDELAY,
          );
        // wait for 2 days
        await setNextMineTimestamp(start + 2 * 24 * 60 * 60);

        // operator just finished withdrawing the pendingBond of this round's DOTs
        await timelock
          .connect(proposerAndExecutor)
          .execute(
            withdrawPendingBondOperation.target,
            withdrawPendingBondOperation.value,
            withdrawPendingBondOperation.data,
            withdrawPendingBondOperation.predecessor,
            withdrawPendingBondOperation.salt,
          );

        // await liquidStaking.connect(operator).withdrawPendingBond();
        expect(await liquidStaking.totalPendingBondAmount()).to.equal(0);
        expect(await dot.balanceOf(operator.address)).to.equal(ethers.utils.parseUnits("999.895", 10));

        // bob decides to unstake part of his staked DOT
        await liquidStaking.connect(bobUser).unstake(ethers.utils.parseUnits("150", 10));
        // bob's DOT remain the same (10000 - 300)
        expect(await dot.balanceOf(bobUser.address)).to.equal(ethers.utils.parseUnits("9700", 10));

        await expect(liquidStaking.connect(bobUser).claimDOT()).to.be.revertedWith("NoClaimableUnbondedDot");
      });

      it("should let user harvest WASTR rewards with unclaimedReward", async () => {
        await liquidStaking.connect(bobUser).harvest(wastr.address);
        expect(await wastr.balanceOf(bobUser.address)).to.be.closeTo(
          await calculateReward((await liquidStaking.balanceOf(bobUser.address)).toNumber(), 37000),
          ethers.utils.parseEther("0.0001"),
        );
        const [, , , , unclaimedReward] = await liquidStaking.getUserInfo(aliceUser.address, wastr.address);
        expect(unclaimedReward).to.equal(0);
      });
    });

    describe("Snenario for sDOT holders", function () {
      it("should let sDOT holder claim their DOT immediately if next round of bonding request hasn't started", async () => {
        await liquidStaking.connect(bobUser).unstake(ethers.utils.parseUnits("200", 10));

        expect(await dot.balanceOf(feeCollector.address)).to.equal(ethers.utils.parseUnits("0.105", 10));
        expect(await liquidStaking.balanceOf(bobUser.address)).to.equal(ethers.utils.parseUnits("99.965", 10));
        expect(await dot.balanceOf(bobUser.address)).to.equal(ethers.utils.parseUnits("9900", 10));
      });
      it("should not let any sDOT holder unstake immediately if they don't have enough sDOTs", async () => {
        await liquidStaking.connect(carolUser).transfer(randomUser.address, ethers.utils.parseUnits("50", 10));
        expect(await liquidStaking.balanceOf(carolUser.address)).to.equal(ethers.utils.parseUnits("149.965", 10));

        await expect(
          liquidStaking.connect(carolUser).unstake(ethers.utils.parseUnits("199.965", 10)),
        ).to.be.revertedWith("NotEnoughSDotBalance");
      });
      it("should let sDOT holder who bought extra sDOT directly from market stake and initiate unstake request afterwards", async () => {
        // Bob user sends 150 sDot to a randomUser, then randomUser unstake
        await liquidStaking.connect(bobUser).transfer(randomUser.address, ethers.utils.parseUnits("150", 10));
        expect(await liquidStaking.balanceOf(randomUser.address)).to.be.equal(ethers.utils.parseUnits("150", 10));
        expect(await liquidStaking.balanceOf(bobUser.address)).to.be.equal(ethers.utils.parseUnits("149.965", 10));

        await expect(liquidStaking.connect(randomUser).stake(ethers.utils.parseUnits("0.07", 10))).to.be.revertedWith(
          "StakeAmountMustBeMoreThanTransactionFeeTwice",
        );

        await liquidStaking.connect(randomUser).stake(ethers.utils.parseUnits("100", 10));
        expect(await liquidStaking.totalPendingBondAmount()).to.equal(ethers.utils.parseUnits("1099.86", 10));
        expect(await liquidStaking.balanceOf(randomUser.address)).to.be.equal(ethers.utils.parseUnits("249.965", 10));

        await expect(
          liquidStaking.connect(randomUser).unstake(ethers.utils.parseUnits("0.035", 10)),
        ).to.be.revertedWith("UnstakeAmountMustBeMoreThanTransactionFee");

        // user unstaking more than original pendingBond amount after receiving extra sDot
        await liquidStaking.connect(randomUser).unstake(ethers.utils.parseUnits("200", 10));

        // 1099.86 - 99.965
        expect(await liquidStaking.totalPendingBondAmount()).to.equal(ethers.utils.parseUnits("999.895", 10));
        expect(await liquidStaking.balanceOf(randomUser.address)).to.equal(ethers.utils.parseUnits("150", 10));

        const [, pendingUnbondAmount, , ,] = await liquidStaking.getUserInfo(randomUser.address, wastr.address);
        expect(pendingUnbondAmount).to.be.equal(ethers.utils.parseUnits("100.035", 10));
      });
      it("should let sDOT holder who bought sDOT directly from market initiate unstake request", async () => {
        // Bob user sends 150 sDot to a randomUser, then randomUser unstake
        await liquidStaking.connect(bobUser).transfer(randomUser.address, ethers.utils.parseUnits("150", 10));

        await liquidStaking.connect(randomUser).unstake(ethers.utils.parseUnits("100", 10));
        const [, pendingUnbondAmount, , ,] = await liquidStaking.getUserInfo(randomUser.address, wastr.address);
        expect(pendingUnbondAmount).to.be.equal(ethers.utils.parseUnits("100", 10));
      });
    });

    describe("[Operator deposited unbonded DOTs] One user unstakes, operator deposits unbonded DOTs, then user claims back DOTs", function () {
      it("should let unstaker claim DOT after having claimable unbonded DOT", async () => {
        // activiate timelock for `withdrawPendingBond`
        await timelock
          .connect(proposerAndExecutor)
          .schedule(
            withdrawPendingBondOperation.target,
            withdrawPendingBondOperation.value,
            withdrawPendingBondOperation.data,
            withdrawPendingBondOperation.predecessor,
            withdrawPendingBondOperation.salt,
            MINDELAY,
          );
        // wait for 2 days
        await setNextMineTimestamp(start + 2 * 24 * 60 * 60);

        // operator withdraws pendingBond to stake to relay chain
        await timelock
          .connect(proposerAndExecutor)
          .execute(
            withdrawPendingBondOperation.target,
            withdrawPendingBondOperation.value,
            withdrawPendingBondOperation.data,
            withdrawPendingBondOperation.predecessor,
            withdrawPendingBondOperation.salt,
          );
        // await liquidStaking.connect(operator).withdrawPendingBond();

        expect(await dot.balanceOf(operator.address)).to.be.equal(ethers.utils.parseUnits("999.895", 10));

        await liquidStaking.connect(carolUser).unstake(ethers.utils.parseUnits("100", 10));
        // carol's sDot got burned after initiating unstake request
        expect(await liquidStaking.balanceOf(carolUser.address)).to.equal(ethers.utils.parseUnits("99.965", 10));

        const [amount, pendingUnbondAmount, , ,] = await liquidStaking.getUserInfo(carolUser.address, wastr.address);
        expect(amount).to.be.equal(ethers.utils.parseUnits("99.965", 10));
        expect(pendingUnbondAmount).to.be.equal(ethers.utils.parseUnits("100", 10));

        const depositUnbondedABI = ["function depositUnbonded(address _user, uint256 _amount)"];
        const depositUnbondediface = new ethers.utils.Interface(depositUnbondedABI);
        const depositUnbondedOperation = genOperation(
          liquidStaking.address,
          0,
          depositUnbondediface.encodeFunctionData("depositUnbonded", [
            carolUser.address,
            ethers.utils.parseUnits("100", 10),
          ]),
          ZERO_BYTES32,
          salt,
        );

        // activiate timelock for `depositUnbonded`
        await timelock
          .connect(proposerAndExecutor)
          .schedule(
            depositUnbondedOperation.target,
            depositUnbondedOperation.value,
            depositUnbondedOperation.data,
            depositUnbondedOperation.predecessor,
            depositUnbondedOperation.salt,
            MINDELAY,
          );
        // wait for another 2 days
        const currentTime = await getBlockDateTime(ethers.provider);
        await setNextMineTimestamp(currentTime.plus({ days: 2 }).toSeconds());

        // operator deposited the unbonded DOTs after processing prev round's unstake request
        await timelock
          .connect(proposerAndExecutor)
          .execute(
            depositUnbondedOperation.target,
            depositUnbondedOperation.value,
            depositUnbondedOperation.data,
            depositUnbondedOperation.predecessor,
            depositUnbondedOperation.salt,
          );

        // await liquidStaking.connect(operator).depositUnbonded(carolUser.address, ethers.utils.parseUnits("100", 10));
        const [, newPendingUnbondAmount, newClaimableUnbondedAmount, ,] = await liquidStaking.getUserInfo(
          carolUser.address,
          wastr.address,
        );
        expect(newPendingUnbondAmount).to.be.equal(0);
        expect(newClaimableUnbondedAmount).to.be.equal(ethers.utils.parseUnits("99.965", 10));

        expect(await dot.balanceOf(operator.address)).to.be.equal(ethers.utils.parseUnits("899.895", 10));

        // carol claims DOT directly
        await liquidStaking.connect(carolUser).claimDOT();
        expect(await dot.balanceOf(carolUser.address)).to.be.equal(ethers.utils.parseUnits("9899.965", 10));
      });
    });

    describe("[Paused the contract] One user stake, operator withdraw pending bond", function () {
      this.beforeEach(async () => {
        const pauseABI = ["function pause()"];
        const pauseiface = new ethers.utils.Interface(pauseABI);
        pauseOperation = genOperation(
          liquidStaking.address,
          0,
          pauseiface.encodeFunctionData("pause"),
          ZERO_BYTES32,
          salt,
        );

        return {
          pauseOperation,
        };
      });

      it("should not let any users other than contract owner to pause contract", async () => {
        // randomUser try to activiate timelock
        await expect(
          timelock
            .connect(randomUser)
            .schedule(
              pauseOperation.target,
              pauseOperation.value,
              pauseOperation.data,
              pauseOperation.predecessor,
              pauseOperation.salt,
              MINDELAY,
            ),
        ).to.be.reverted;
        // await expect(liquidStaking.connect(randomUser).pause()).to.be.revertedWith("Ownable: caller is not the owner");
      });
      it("should not let any users stake anymore if contract is paused", async () => {
        //  activiate timelock
        await timelock
          .connect(proposerAndExecutor)
          .schedule(
            pauseOperation.target,
            pauseOperation.value,
            pauseOperation.data,
            pauseOperation.predecessor,
            pauseOperation.salt,
            MINDELAY,
          );
        // wait for 2 days
        await setNextMineTimestamp(start + 2 * 24 * 60 * 60);

        await timelock
          .connect(proposerAndExecutor)
          .execute(
            pauseOperation.target,
            pauseOperation.value,
            pauseOperation.data,
            pauseOperation.predecessor,
            pauseOperation.salt,
          );
        // await liquidStaking.connect(contractOwner).pause();
        await expect(liquidStaking.connect(bobUser).stake(ethers.utils.parseUnits("300", 10))).to.be.revertedWith(
          "Pausable: paused",
        );
      });
      it("should not let operator withdraw pending bond if contract is paused", async () => {
        // first, activiate timelock for `pause`
        await timelock
          .connect(proposerAndExecutor)
          .schedule(
            pauseOperation.target,
            pauseOperation.value,
            pauseOperation.data,
            pauseOperation.predecessor,
            pauseOperation.salt,
            MINDELAY,
          );
        // wait for 2 days
        await setNextMineTimestamp(start + 2 * 24 * 60 * 60);
        await timelock
          .connect(proposerAndExecutor)
          .execute(
            pauseOperation.target,
            pauseOperation.value,
            pauseOperation.data,
            pauseOperation.predecessor,
            pauseOperation.salt,
          );

        // then, activiate timelock for `withdrawPendingBond`
        await timelock
          .connect(proposerAndExecutor)
          .schedule(
            withdrawPendingBondOperation.target,
            withdrawPendingBondOperation.value,
            withdrawPendingBondOperation.data,
            withdrawPendingBondOperation.predecessor,
            withdrawPendingBondOperation.salt,
            MINDELAY,
          );
        // wait for another 2 days
        const currentTime = await getBlockDateTime(ethers.provider);
        await setNextMineTimestamp(currentTime.plus({ days: 2 }).toSeconds());

        // Originally reverted with "Pausable: paused"
        await expect(
          timelock
            .connect(proposerAndExecutor)
            .execute(
              withdrawPendingBondOperation.target,
              withdrawPendingBondOperation.value,
              withdrawPendingBondOperation.data,
              withdrawPendingBondOperation.predecessor,
              withdrawPendingBondOperation.salt,
            ),
        ).to.be.reverted;

        // await expect(liquidStaking.connect(operator).withdrawPendingBond()).to.be.revertedWith("Pausable: paused");
      });
      it("should let users unstake if contract is not paused", async () => {
        //  activiate timelock
        await timelock
          .connect(proposerAndExecutor)
          .schedule(
            pauseOperation.target,
            pauseOperation.value,
            pauseOperation.data,
            pauseOperation.predecessor,
            pauseOperation.salt,
            MINDELAY,
          );
        // wait for 2 days
        await setNextMineTimestamp(start + 2 * 24 * 60 * 60);

        // randomUser try to execute the function after timelock expired
        await expect(
          timelock
            .connect(randomUser)
            .execute(
              pauseOperation.target,
              pauseOperation.value,
              pauseOperation.data,
              pauseOperation.predecessor,
              pauseOperation.salt,
            ),
        ).to.be.reverted;

        // await expect(liquidStaking.connect(randomUser).pause()).to.be.revertedWith("Ownable: caller is not the owner");
        await liquidStaking.connect(bobUser).unstake(ethers.utils.parseUnits("200", 10));
      });
    });
  });

  after(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [],
    });
  });
});