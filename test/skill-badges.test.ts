import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
    SkillBadges,
    Slot1,
    Slot2,
    RMRKTokenAttributesRepository,
    RMRKRegistry,
    RMRKCatalogImpl,
} from '../typechain-types';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import {
    deploySkillBadges,
    deploySlots,
    deployCatalog,
    configureCatalog,
    addAssets,
} from '../scripts/deploy-methods'; // Adjust the import path as needed
import { getRegistry } from '../scripts/get-registry'; // Import getRegistry
import * as C from '../scripts/constants'; // Import constants

describe('SkillBadges and Slots Access Control Tests', function () {
    let skillBadges: SkillBadges;
    let slots: { [key: string]: any };
    let catalog: RMRKCatalogImpl;
    let attributeRepo: RMRKTokenAttributesRepository;
    let registry: RMRKRegistry;
    let deployer: SignerWithAddress;
    let publisher1: SignerWithAddress;
    let publisher2: SignerWithAddress;
    let user1: SignerWithAddress;
    let user2: SignerWithAddress;
    let skillBadgesAddress: string;
    let slotAddresses: { [key: string]: string } = {};
    let slot1: Slot1;

    before(async function () {
        // Get signers
        [deployer, publisher1, publisher2, user1, user2] = await ethers.getSigners();
        console.log(`Deployer: ${deployer.address}`);
        console.log(`Publisher 1: ${publisher1.address}`);
        console.log(`Publisher 2: ${publisher2.address}`);
        console.log(`User 1: ${user1.address}`);
        console.log(`User 2: ${user2.address}`);


        // Get or deploy RMRKRegistry
        try {
            registry = await getRegistry();
        } catch (error) {
            // Deploy MockRMRKRegistry for testing
            const RegistryFactory = await ethers.getContractFactory('MockRMRKRegistry');
            registry = await RegistryFactory.connect(deployer).deploy();
            await registry.waitForDeployment();
        }

        // Deploy RMRKTokenAttributesRepository
        const AttributeRepoFactory = await ethers.getContractFactory('RMRKTokenAttributesRepository');
        attributeRepo = await AttributeRepoFactory.connect(deployer).deploy();
        await attributeRepo.waitForDeployment();

        // Deploy the catalog
        catalog = await deployCatalog(C.CATALOG_METADATA, C.CATALOG_TYPE);

        // Deploy SkillBadges contract
        skillBadges = await deploySkillBadges();
        skillBadgesAddress = await skillBadges.getAddress();

        // Deploy Slot contracts
        slots = await deploySlots();

        // Prepare slot addresses for catalog configuration
        for (let i = 1; i <= 8; i++) {
            slotAddresses[`Slot${i}`] = await slots[`Slot${i}`].getAddress();
        }
        console.log(`Slot 1: ${slotAddresses['Slot1']}`);
        console.log(`Slot 2: ${slotAddresses['Slot2']}`);

        // Configure the catalog
        await configureCatalog(catalog, slotAddresses);

        // Add assets to SkillBadges and Slots
        await addAssets(skillBadges, slots, catalog);

        // Set auto-accept for equipping slots into SkillBadges
        for (let i = 1; i <= 8; i++) {
            let tx = await skillBadges.setAutoAcceptCollection(slotAddresses[`Slot${i}`], true);
            await tx.wait();
        }

        // Register SkillBadges and Slots in the registry
        await registry.addExternalCollection(skillBadgesAddress, `${C.BASE_URI}/badge/collection.json`);
        for (let i = 1; i <= 8; i++) {
            const slotAddress = slotAddresses[`Slot${i}`];
            await registry.addExternalCollection(slotAddress, `${C.BASE_URI}/items/slot${i}/collection.json`);
        }

        // Register SkillBadges and Slots in the attribute repository
        await attributeRepo.connect(deployer).registerAccessControl(
            skillBadgesAddress,
            deployer.address,
            false
        );

        for (let i = 1; i <= 8; i++) {
            const slotAddress = slotAddresses[`Slot${i}`];
            await attributeRepo.connect(deployer).registerAccessControl(
                slotAddress,
                deployer.address,
                false // Not using Ownable pattern
            );
        }

        // Assign collaborators for SkillBadges and Slots
        await attributeRepo.connect(deployer).manageCollaborators(
            skillBadgesAddress,
            [publisher1.address, publisher2.address],
            [true, true]
        );

        for (let i = 1; i <= 8; i++) {
            const slotAddress = slotAddresses[`Slot${i}`];
            await attributeRepo.connect(deployer).manageCollaborators(
                slotAddress,
                [publisher1.address, publisher2.address],
                [true, true]
            );
        }

        // Assign contributors in SkillBadges and Slots
        await skillBadges.connect(deployer).manageContributor(publisher1.address, true);
        await skillBadges.connect(deployer).manageContributor(publisher2.address, true);

        for (let i = 1; i <= 8; i++) {
            const slotContract = slots[`Slot${i}`];
            await slotContract.connect(deployer).manageContributor(publisher1.address, true);
            await slotContract.connect(deployer).manageContributor(publisher2.address, true);

        }

        const assetId = 1n;
        await skillBadges.connect(deployer).mint(user1.address, 1n, assetId);
        await skillBadges.connect(deployer).mint(user2.address, 2n, assetId);
        const parentId = 1n;
        slot1 = slots[`Slot1`];
        await slot1
            .connect(deployer)
            .nestMint(skillBadgesAddress, parentId, [1n]);
        console.log(await skillBadges.ownerOf(1n), deployer.address);
    });

    describe('Minting NFTs by Publishers', function () {
        it('Publisher1 can mint Slot NFTs and nest them into SkillBadges', async function () {
            const parentId = 1n;

            const slotContract = slots[`Slot2`];

            const tx = await slotContract
                .connect(publisher2)
                .nestMint(skillBadgesAddress, parentId, [1n]);
            const receipt = await tx.wait();
            const transferEvent = receipt.logs
                .map(log => slotContract.interface.parseLog(log))
                .find(e => e.name === 'Transfer');
            const slotTokenId = transferEvent?.args?.tokenId;

            expect(await slotContract.ownerOf(slotTokenId)).to.equal(user1.address);

        });

        it('User without contributor role cannot mint Slot NFTs', async function () {
            const slotContract = slots['Slot2'];
            await expect(
                slotContract.connect(user1).nestMint(skillBadgesAddress, 1n, [1n])
            ).to.be.revertedWithCustomError(slotContract, 'RMRKNotOwnerOrContributor');
        });
    });

    describe('Modifying Attributes by Publishers', function () {
        before(async function () {
            // Set AccessType for 'level' key to allow collaborators on SkillBadges
            await attributeRepo.connect(deployer).manageAccessControl(
                skillBadgesAddress,
                'level',
                1, // AccessType.Collaborator
                ethers.ZeroAddress
            );
        });

        it('Publisher1 can set string attribute of SkillBadges NFT', async function () {
            const tokenId = 1n;
            const key = 'level';
            const value = 'advanced';

            // Use skillBadgesAddress as the collection address
            await attributeRepo.connect(publisher1).setStringAttribute(
                skillBadgesAddress,
                tokenId,
                key,
                value
            );
            const attribute = await attributeRepo.getStringAttribute(skillBadgesAddress, tokenId, key);
            expect(attribute).to.equal(value);
        });

        it('User without collaborator role cannot set string attribute', async function () {
            const tokenId = 1n;
            const key = 'level';
            const value = 'beginner';

            await expect(
                attributeRepo.connect(user1).setStringAttribute(
                    skillBadgesAddress,
                    tokenId,
                    key,
                    value
                )
            ).to.be.revertedWithCustomError(attributeRepo, 'NotCollectionCollaborator');
        });
    });


    describe('Setting Valid Parents by Contributors', function () {
        it('Publisher1 can set valid parent for equippable group', async function () {
            const slotContract = slots['Slot1'];
            await slotContract.connect(publisher1).setValidParentForEquippableGroup(
                1n, // equippableGroupId
                skillBadgesAddress, // parentAddress
                1n // slotPartId
            );
        });

        it('User without contributor role cannot set valid parent for equippable group', async function () {
            const slotContract = slots['Slot1'];
            await expect(
                slotContract.connect(user1).setValidParentForEquippableGroup(
                    1n,
                    skillBadgesAddress,
                    1n
                )
            ).to.be.revertedWithCustomError(slotContract, 'RMRKNotOwnerOrContributor');
        });
    });
});