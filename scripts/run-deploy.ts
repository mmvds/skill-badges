import {
  deploySkillBadges,
  deploySlots,
  deployCatalog,
  configureCatalog,
  addAssets,
} from './deploy-methods';
import * as C from './constants';
import { ethers } from 'hardhat';

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying contracts with the account: ${deployer.address}`);

  // Deploy the catalog
  const catalog = await deployCatalog(C.CATALOG_METADATA, C.CATALOG_TYPE);

  // Deploy SkillBadges contract
  const skillBadges = await deploySkillBadges();

  // Deploy Slot contracts
  const slots = await deploySlots();

  // Prepare slot addresses for catalog configuration
  const slotAddresses: { [key: string]: string } = {};
  for (let i = 1; i <= 8; i++) {
    slotAddresses[`Slot${i}`] = await slots[`Slot${i}`].getAddress();
  }

  // Configure the catalog
  await configureCatalog(catalog, slotAddresses);

  // Add assets to SkillBadges and Slots
  await addAssets(skillBadges, slots, catalog);

  // Set auto-accept for equipping slots into SkillBadges
  for (let i = 1; i <= 8; i++) {
    let tx = await skillBadges.setAutoAcceptCollection(slotAddresses[`Slot${i}`], true);
    await tx.wait();
  }

  console.log('Deployment complete!');

  // Mint SkillBadges NFTs to the specified addresses
  const address1 = process.env.USER1_ADDRESS || '';
  const address2 = process.env.USER2_ADDRESS || '';

  let tx = await skillBadges.mint(address1, 1, 1n);
  await tx.wait();
  console.log(`Minted SkillBadge with id 1 to ${address1}`);

  tx = await skillBadges.mint(address2, 2, 1n);
  await tx.wait();
  console.log(`Minted SkillBadge with id 2 to ${address2}`);

  // Mint Slot NFTs and equip them to SkillBadges
  // For address1: Add all badges (1 in each slot and 3 types in slot 3)
  // For address2: Add the last 4 NFTs for the slots

  // Mint and nest Slot NFTs for address1
  const parentId1 = 1n; // SkillBadge token ID for address1
  for (let i = 1; i <= 8; i++) {
    const slotContract = slots[`Slot${i}`];

    let assetIds: bigint[] = [1n];
    if (i === 3) {
      assetIds = [1n, 2n, 3n]; // Slot3 has 3 types
    }

    tx = await slotContract.nestMint(skillBadges.getAddress(), parentId1, assetIds);
    await tx.wait();
    console.log(`Minted Slot${i} NFTs to SkillBadge with id ${parentId1}`);
  }

  // Mint and nest Slot NFTs for address2 (last 4 slots)
  const parentId2 = 2n; // SkillBadge token ID for address2
  for (let i = 5; i <= 8; i++) {
    const slotContract = slots[`Slot${i}`];
    tx = await slotContract.nestMint(skillBadges.getAddress(), parentId2, [1n]);
    await tx.wait();
    console.log(`Minted Slot${i} NFT to SkillBadge with id ${parentId2}`);
  }

  console.log('Minting complete!');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
