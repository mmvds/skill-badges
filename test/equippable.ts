import { ethers } from 'hardhat';
import { expect } from 'chai';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { SkillBadges } from '../typechain-types';

async function fixture(): Promise<SkillBadges> {
  const equipFactory = await ethers.getContractFactory('SkillBadges');
  const equip: SkillBadges = await equipFactory.deploy(
    'ipfs://collectionMeta',
    1000n, // max supply
    ethers.ZeroAddress, // royaltyRecipient
    300, // royaltyPercentageBps
  );
  await equip.waitForDeployment();

  return equip;
}

describe('SkillBadges Assets', async () => {
  let equip: SkillBadges;
  beforeEach(async function () {
    equip = await loadFixture(fixture);
  });

  describe('Init', async function () {
    it('can get names and symbols', async function () {
      expect(await equip.name()).to.equal('SkillBadges');
      expect(await equip.symbol()).to.equal('SKBG');
    });
  });
});
