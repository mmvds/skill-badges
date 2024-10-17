import { ethers, run, network } from 'hardhat';
import { delay, isHardhatNetwork } from './utils';
import {
  RMRKBulkWriter,
  RMRKCatalogImpl,
  RMRKCatalogUtils,
  RMRKCollectionUtils,
  RMRKEquipRenderUtils,
  RMRKRoyaltiesSplitter,
  Slot1,
  Slot2,
  Slot3,
  Slot4,
  Slot5,
  Slot6,
  Slot7,
  Slot8,
  SkillBadges,
} from '../typechain-types';
import { getRegistry } from './get-registry';
import * as C from './constants';

export async function addAssets(
  skillBadges: SkillBadges,
  slots: { [key: string]: any },
  catalog: RMRKCatalogImpl,
): Promise<void> {
  console.log('Adding assets to SkillBadges...');

  // Add equippable asset to SkillBadges (the base badge)
  let tx = await skillBadges.addEquippableAssetEntry(
    0n,
    await catalog.getAddress(),
    C.BADGE_ASSET_METADATA_URI,
    [
      C.SLOT_FOR_SLOT1_ID,
      C.SLOT_FOR_SLOT2_ID,
      C.SLOT_FOR_SLOT3_ID,
      C.SLOT_FOR_SLOT4_ID,
      C.SLOT_FOR_SLOT5_ID,
      C.SLOT_FOR_SLOT6_ID,
      C.SLOT_FOR_SLOT7_ID,
      C.SLOT_FOR_SLOT8_ID,
      C.FIXED_PART_BADGE_ID,
    ],
  );
  await tx.wait();

  // Add assets to each slot contract
  for (let i = 1; i <= 8; i++) {
    const slotContract = slots[`Slot${i}`];
    const equippableGroupId = C[`SLOT_FOR_SLOT${i}_ID`];
    const metadataUriKey = `SLOT${i}_ASSET_METADATA_URI_1`;
    const metadataUri = C[metadataUriKey];

    // Add equippable asset entry for the slot
    tx = await slotContract.addEquippableAssetEntry(
      equippableGroupId,
      ethers.ZeroAddress,
      metadataUri,
      [],
    );
    await tx.wait();

    // Set valid parent for equippable group
    tx = await slotContract.setValidParentForEquippableGroup(
      equippableGroupId,
      await skillBadges.getAddress(),
      C[`SLOT_FOR_SLOT${i}_ID`],
    );
    await tx.wait();
  }

  // Handle additional assets for Slot3 (since it has multiple types)
  const slot3 = slots['Slot3'];
  const slot3EquippableGroupId = C.SLOT_FOR_SLOT3_ID;
  for (let j = 2; j <= 3; j++) {
    const metadataUri = C[`SLOT3_ASSET_METADATA_URI_${j}`];
    tx = await slot3.addEquippableAssetEntry(
      slot3EquippableGroupId,
      ethers.ZeroAddress,
      metadataUri,
      [],
    );
    await tx.wait();
  }
}

export async function configureCatalog(
  catalog: RMRKCatalogImpl,
  slotAddresses: { [key: string]: string },
): Promise<void> {
  console.log('Configuring Catalog...');

  // Add fixed part (badge)
  let tx = await catalog.addPart({
    partId: C.FIXED_PART_BADGE_ID,
    part: {
      itemType: C.PART_TYPE_FIXED,
      z: C.Z_INDEX_FOR_BADGE,
      equippable: [],
      metadataURI: C.FIXED_PART_BADGE_METADATA,
    },
  });
  await tx.wait();

  // Add slots
  for (let i = 1; i <= 8; i++) {
    tx = await catalog.addPart({
      partId: C[`SLOT_FOR_SLOT${i}_ID`],
      part: {
        itemType: C.PART_TYPE_SLOT,
        z: C[`Z_INDEX_FOR_SLOT${i}`],
        equippable: [slotAddresses[`Slot${i}`]],
        metadataURI: C[`SLOT_FOR_SLOT${i}_METADATA`],
      },
    });
    await tx.wait();
  }

  console.log('Catalog configured');
}

export async function deploySkillBadges(): Promise<SkillBadges> {
  console.log(`Deploying SkillBadges to ${network.name} blockchain...`);

  const contractFactory = await ethers.getContractFactory('SkillBadges');
  const args = [
    `${C.BASE_URI}/badge/collection.json`,
    100n,
    (await ethers.getSigners())[0].address,
    300,
  ] as const;
  const contract: SkillBadges = await contractFactory.deploy(...args);
  await contract.waitForDeployment();
  const contractAddress = await contract.getAddress();
  console.log(`SkillBadges deployed to ${contractAddress}`);

  if (!isHardhatNetwork()) {
    console.log('Waiting 20 seconds before verifying contract...');
    await delay(20000);
    await run('verify:verify', {
      address: contractAddress,
      constructorArguments: args,
      contract: 'contracts/SkillBadges.sol:SkillBadges',
    });

    // Only do on testing, or if whitelisted for production
    const registry = await getRegistry();
    await registry.addExternalCollection(contractAddress, args[0]);
    console.log('Collection added to NFT Registry');
  }
  return contract;
}

export async function deploySlots(): Promise<{ [key: string]: any }> {
  console.log(`Deploying Slot contracts to ${network.name} blockchain...`);

  const slots: { [key: string]: any } = {};

  for (let i = 1; i <= 8; i++) {
    const contractName = `Slot${i}`;
    const contractFactory = await ethers.getContractFactory(contractName);
    const args = [
      `${C.BASE_URI}/items/slot${i}/collection.json`,
      100n,
      (await ethers.getSigners())[0].address,
      300,
    ] as const;
    const contract = await contractFactory.deploy(...args);
    await contract.waitForDeployment();
    const contractAddress = await contract.getAddress();
    console.log(`${contractName} deployed to ${contractAddress}`);

    if (!isHardhatNetwork()) {
      console.log('Waiting 20 seconds before verifying contract...');
      await delay(20000);
      await run('verify:verify', {
        address: contractAddress,
        constructorArguments: args,
        contract: `contracts/${contractName}.sol:${contractName}`,
      });

      // Only do on testing, or if whitelisted for production
      const registry = await getRegistry();
      await registry.addExternalCollection(contractAddress, args[0]);
      console.log('Collection added to NFT Registry');
    }

    slots[contractName] = contract;
  }

  return slots;
}

// The rest of the utility functions (deployBulkWriter, deployCatalogUtils, etc.) remain the same.

export async function deployCatalog(
  catalogMetadataUri: string,
  catalogType: string,
): Promise<RMRKCatalogImpl> {
  const catalogFactory = await ethers.getContractFactory('RMRKCatalogImpl');
  const catalog = await catalogFactory.deploy(catalogMetadataUri, catalogType);
  await catalog.waitForDeployment();
  const catalogAddress = await catalog.getAddress();
  console.log('Catalog deployed to:', catalogAddress);

  await verifyIfNotHardhat(catalogAddress, [catalogMetadataUri, catalogType]);
  return catalog;
}

async function verifyIfNotHardhat(contractAddress: string, args: any[] = []) {
  if (isHardhatNetwork()) {
    // Hardhat
    return;
  }

  // sleep 20s
  await delay(20000);

  console.log('Etherscan contract verification starting now.');
  try {
    await run('verify:verify', {
      address: contractAddress,
      constructorArguments: args,
    });
  } catch (error) {
    // probably already verified
  }
}
