import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ethers, network } from "hardhat";
import { WASTR } from "typechain";
import { constants, balance } from "@openzeppelin/test-helpers";

const { ZERO_ADDRESS } = constants;

// const HOLDER_AMOUNT = ethers.utils.parseEther("100");

let wastr: WASTR;
let contractOwner: SignerWithAddress;
let aliceUser: SignerWithAddress;
let bobUser: SignerWithAddress;
let carolUser: SignerWithAddress;
let noASTRUser: SignerWithAddress;

describe("WASTR", function () {
  async function deployContractFixture() {
    [contractOwner, aliceUser, bobUser, carolUser, noASTRUser] = await ethers.getSigners();

    const WASTR = await ethers.getContractFactory("WASTR");

    wastr = (await WASTR.deploy()) as WASTR;

    await wastr.deployed();

    return {
      contractOwner,
      aliceUser,
      bobUser,
      carolUser,
      noASTRUser,
      wastr,
    };
  }

  describe("Deployment", function () {
    it("should initialize data correctly", async () => {
      const { wastr } = await loadFixture(deployContractFixture);

      expect(await wastr.name()).to.equal("Wrapped Astar");
      expect(await wastr.symbol()).to.equal("WASTR");
    });
  });

  describe("Three users wrap their ASTR into WASTR", function () {
    this.beforeEach(async () => {
      const { aliceUser, bobUser, carolUser, noASTRUser, contractOwner, wastr } = await loadFixture(
        deployContractFixture,
      );

      await wastr.connect(aliceUser).deposit({ value: ethers.utils.parseEther("100") });
      await wastr.connect(bobUser).deposit({ value: ethers.utils.parseEther("200") });
      await wastr.connect(carolUser).deposit({ value: ethers.utils.parseEther("50") });

      return {
        contractOwner,
        aliceUser,
        bobUser,
        carolUser,
        noASTRUser,
        wastr,
      };
    });

    it("should update ASTR balance, and mint WASTR for three users", async () => {
      expect(await ethers.provider.getBalance(wastr.address)).to.equal(ethers.utils.parseEther("350"));
      expect(await wastr.balanceOf(aliceUser.address)).to.be.equal(ethers.utils.parseEther("100"));
      expect(await wastr.balanceOf(bobUser.address)).to.be.equal(ethers.utils.parseEther("200"));
      expect(await wastr.balanceOf(carolUser.address)).to.be.equal(ethers.utils.parseEther("50"));
    });

    describe("Two users unwrap their WASTR back to ASTR, one user transfers to other user", function () {
      it("should calculate balance of WASTR for users correctly", async () => {
        await wastr.connect(aliceUser).withdraw(ethers.utils.parseEther("70"));
        expect(await ethers.provider.getBalance(aliceUser.address)).to.be.closeTo(
          ethers.utils.parseEther("9970"),
          ethers.utils.parseEther("0.1"),
        );
        await wastr.connect(aliceUser).transfer(carolUser.address, ethers.utils.parseEther("10"));
        expect(await wastr.balanceOf(carolUser.address)).to.be.equal(ethers.utils.parseEther("60"));
      });
    });

    describe("One user unwrap WASTR to withdraw to another user, and one user wrap all the balance", function () {
      it("should calculate balance of ASTR for users correctly", async () => {
        await wastr.connect(carolUser).withdraw(ethers.utils.parseEther("50"));
        expect(await ethers.provider.getBalance(carolUser.address)).to.be.closeTo(
          ethers.utils.parseEther("10000"),
          ethers.utils.parseEther("9999"),
        );
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