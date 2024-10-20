// SPDX-License-Identifier: MIT

pragma solidity ^0.8.21;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@rmrk-team/evm-contracts/contracts/RMRK/extension/soulbound/IERC6454.sol";
import "@rmrk-team/evm-contracts/contracts/RMRK/equippable/IERC6220.sol";
import "@rmrk-team/evm-contracts/contracts/RMRK/nestable/IERC7401.sol";
import "@rmrk-team/evm-contracts/contracts/RMRK/multiasset/IERC5773.sol";
import "../interfaces/IOwnable.sol";
import "../interfaces/IRMRKRegistry.sol";
import "../interfaces/IRMRKImplementationBase.sol";
import "../upgradeable/PausableUpgradeable.sol";
import "../upgradeable/OwnableUpgradeable.sol";

contract RMRKRegistry is
    OwnableUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    IRMRKRegistry
{
    uint256 public collectionVerificationFee;
    uint256 public totalCollectionsCounter;

    mapping(address => bool) public factories;
    address[] public factoryList;
    IERC20 public rmrkToken;

    address private metaFactoryAddress;

    Collection[] private _collections;
    mapping(address => uint256) private _collectionByAddressIndex;
    uint256 private _collectionsDepositBalance;
    uint256 private _blacklistedCollectionsDepositBalance;
    CollectionConfig private _defaultCollectionConfig;
    CollectionConfig private _defaultCollectionConfigForExternalCollections;

    uint8 public constant CUSTOM_MINTING_TYPE_FOR_EXTERNAL_COLLECTIONS =
        2 ** 8 - 1;
    bool private _isProduction;
    mapping(address issuer => mapping(string collectionSymbol => bool allowed))
        private _collectionsAllowedPerIssuer;
    string private constant _ALL_COLLECTIONS_ALLOWED = "*";

    function initialize(
        address rmrkToken_,
        uint256 collectionVerificationFee_
    ) public initializer {
        __OwnableUpgradeable_init();
        totalCollectionsCounter = 1;
        rmrkToken = IERC20(rmrkToken_);
        collectionVerificationFee = collectionVerificationFee_;
        _defaultCollectionConfig = CollectionConfig(
            true,
            false,
            true,
            true,
            true,
            true,
            true,
            true,
            true,
            0,
            0,
            0x0
        );
        _defaultCollectionConfigForExternalCollections = CollectionConfig(
            true,
            false,
            false,
            false,
            false,
            false,
            false,
            false,
            false,
            0,
            CUSTOM_MINTING_TYPE_FOR_EXTERNAL_COLLECTIONS,
            0x0
        );
    }

    function addExternalCollection(
        address collection,
        string memory collectionMetadata
    ) external {
        if (IOwnable(collection).owner() != _msgSender())
            revert OnlyCollectionOwnerCanAddCollection();

        string memory symbol = IRMRKImplementationBase(collection).symbol();
        if (!isCollectionAllowedForIssuer(msg.sender, symbol))
            revert CollectionNotAllowedForIssuer();

        LegoCombination legoCombination;
        bool supportsEquippable = IERC165(collection).supportsInterface(
            type(IERC6220).interfaceId
        );
        if (supportsEquippable) legoCombination = LegoCombination.Equippable;
        else {
            bool supportsNestable = IERC165(collection).supportsInterface(
                type(IERC7401).interfaceId
            );
            bool supportsMultiAsset = IERC165(collection).supportsInterface(
                type(IERC5773).interfaceId
            );

            if (supportsNestable && supportsMultiAsset)
                legoCombination = LegoCombination.NestableMultiAsset;
            else if (supportsNestable)
                legoCombination = LegoCombination.Nestable;
            else if (supportsMultiAsset)
                legoCombination = LegoCombination.MultiAsset;
            else revert UnsupportedCollection();
        }

        if (IRMRKImplementationBase(collection).totalSupply() > 0)
            revert CannotAddCollectionWithMintedTokens();

        _addCollection(
            collection,
            _msgSender(),
            IRMRKImplementationBase(collection).maxSupply(),
            legoCombination,
            MintingType.Custom,
            IERC165(collection).supportsInterface(type(IERC6454).interfaceId),
            _defaultCollectionConfigForExternalCollections,
            collectionMetadata
        );
    }

    function addCollectionFromFactories(
        address collection,
        address deployer,
        uint256 maxSupply,
        LegoCombination legoCombination,
        MintingType mintingType,
        bool isSoulbound
    ) external {
        if (!factories[_msgSender()]) revert NotFactory();
        _addCollection(
            collection,
            deployer,
            maxSupply,
            legoCombination,
            mintingType,
            isSoulbound,
            _defaultCollectionConfig,
            ""
        );
    }

    function addCollection(
        address collection,
        address deployer,
        uint256 maxSupply,
        LegoCombination legoCombination,
        MintingType mintingType,
        bool isSoulbound,
        CollectionConfig memory config,
        string memory collectionMetadata
    ) public whenNotPaused onlyOwnerOrContributor {
        _addCollection(
            collection,
            deployer,
            maxSupply,
            legoCombination,
            mintingType,
            isSoulbound,
            config,
            collectionMetadata
        );
    }

    function _addCollection(
        address collection,
        address deployer,
        uint256 maxSupply,
        LegoCombination legoCombination,
        MintingType mintingType,
        bool isSoulbound,
        CollectionConfig memory config,
        string memory collectionMetadata
    ) private whenNotPaused {
        if (collection == address(0)) revert CollectionAddressCannotBeZero();

        if (_collectionByAddressIndex[collection] != 0) {
            revert CollectionAlreadyExists();
        }

        Collection memory newCollection = Collection({
            collection: collection,
            verificationSponsor: 0x0000000000000000000000000000000000000000,
            verificationFeeBalance: 0,
            legoCombination: legoCombination,
            mintingType: mintingType,
            isSoulbound: isSoulbound,
            config: config,
            visible: true,
            verified: false
        });

        string memory name = IRMRKImplementationBase(collection).name();
        string memory symbol = IRMRKImplementationBase(collection).symbol();
        string memory finalCollectionMetadata;

        if (bytes(collectionMetadata).length > 0) {
            finalCollectionMetadata = collectionMetadata;
        } else {
            try
                IRMRKImplementationBase(collection).collectionMetadata()
            returns (string memory collectionMeta) {
                finalCollectionMetadata = collectionMeta;
            } catch {
                try IRMRKImplementationBase(collection).contractURI() returns (
                    string memory contractURI
                ) {
                    finalCollectionMetadata = contractURI;
                } catch {
                    revert CollectionMetadataNotAvailable();
                }
            }
        }

        _collections.push(newCollection);
        _collectionByAddressIndex[collection] = totalCollectionsCounter;
        totalCollectionsCounter++;
        emit CollectionAdded(
            collection,
            deployer,
            name,
            symbol,
            maxSupply,
            finalCollectionMetadata,
            legoCombination,
            mintingType,
            isSoulbound,
            config
        );
    }

    function sponsorVerification(
        address collectionAddress
    ) public whenNotPaused {
        if (
            rmrkToken.allowance(_msgSender(), address(this)) <
            collectionVerificationFee
        ) revert NotEnoughAllowance();

        if (rmrkToken.balanceOf(_msgSender()) < collectionVerificationFee)
            revert NotEnoughBalance();

        uint256 index = _collectionByAddressIndex[collectionAddress];
        if (index == 0) {
            revert CollectionDoesNotExist(collectionAddress);
        }

        _collectionsDepositBalance += collectionVerificationFee;
        Collection storage collection = _collections[index - 1];

        if (collection.verificationSponsor != address(0)) {
            revert CollectionAlreadySponsored();
        }
        collection.verificationFeeBalance = collectionVerificationFee;
        collection.verificationSponsor = _msgSender();

        rmrkToken.transferFrom(
            _msgSender(),
            address(this),
            collectionVerificationFee
        );
        emit CollectionSponsored(collectionAddress, _msgSender());
    }

    function cancelSponsorship(address collectionAddress) public whenNotPaused {
        uint256 index = _collectionByAddressIndex[collectionAddress];
        if (index == 0) {
            revert CollectionDoesNotExist(collectionAddress);
        }

        Collection storage collection = _collections[index - 1];
        if (collection.verificationSponsor != _msgSender()) {
            revert CollectionNotSponsoredBySender();
        }

        if (collection.verified) revert CollectionAlreadyVerified();

        uint256 verificationFeeBalance = collection.verificationFeeBalance;

        _collectionsDepositBalance -= verificationFeeBalance;
        collection.verificationFeeBalance = 0;
        collection.verificationSponsor = address(0);

        rmrkToken.transfer(_msgSender(), verificationFeeBalance);
        emit CollectionSponsorshipCancelled(collectionAddress);
    }

    function verifyCollection(
        address collectionAddress
    ) external onlyOwnerOrContributor {
        uint256 index = _collectionByAddressIndex[collectionAddress];
        if (index == 0) {
            revert CollectionDoesNotExist(collectionAddress);
        }

        Collection storage collection = _collections[index - 1];
        if (collection.verificationFeeBalance == 0)
            revert CollectionNotSponsored();
        collection.verified = true;
        emit CollectionVerified(collectionAddress);
    }

    function unverifyCollection(
        address collectionAddress
    ) external onlyOwnerOrContributor {
        uint256 index = _collectionByAddressIndex[collectionAddress];
        if (index == 0) {
            revert CollectionDoesNotExist(collectionAddress);
        }

        _collections[index - 1].verified = false;
        emit CollectionUnverified(collectionAddress);
    }

    function declineVerification(
        address collectionAddress
    ) external onlyOwnerOrContributor {
        Collection storage collection = _collections[
            _collectionByAddressIndex[collectionAddress] - 1
        ];
        _blacklistedCollectionsDepositBalance += collection
            .verificationFeeBalance;
        _collectionsDepositBalance -= collection.verificationFeeBalance;
        collection.verificationFeeBalance = 0;
        collection
            .verificationSponsor = 0x0000000000000000000000000000000000000000;
    }

    function getCollectionByIndex(
        uint256 index
    ) public view returns (Collection memory) {
        return _collections[index];
    }

    function getCollectionAddressByIndex(
        uint256 index
    ) public view returns (address) {
        return _collections[index].collection;
    }

    function getCollectionByAddress(
        address collectionAddress
    ) public view returns (Collection memory) {
        uint256 index = _collectionByAddressIndex[collectionAddress];
        if (index == 0) {
            revert CollectionDoesNotExist(collectionAddress);
        }
        return _collections[index - 1];
    }

    function isCollectionInRegistry(
        address collection
    ) external view returns (bool) {
        return _collectionByAddressIndex[collection] != 0;
    }

    function updateRMRKTokenAddress(
        address rmrkToken_
    ) external onlyOwnerOrContributor {
        rmrkToken = IERC20(rmrkToken_);
    }

    function updateCollectionVerificationFee(
        uint256 collectionVerificationFee_
    ) external onlyOwnerOrContributor {
        collectionVerificationFee = collectionVerificationFee_;
    }

    function addFactory(address factory) external onlyOwnerOrContributor {
        factories[factory] = true;
        factoryList.push(factory);
    }

    function setMetaFactory(
        address metaFactory
    ) external onlyOwnerOrContributor {
        metaFactoryAddress = metaFactory;
    }

    function removeFactory(
        address factory,
        uint256 factoryIndex
    ) external onlyOwnerOrContributor {
        delete factories[factory];
        delete factoryList[factoryIndex];
    }

    function blackListCollection(
        address collectionAddress
    ) external onlyOwnerOrContributor {
        Collection storage collection = _collections[
            _collectionByAddressIndex[collectionAddress] - 1
        ];
        _blacklistedCollectionsDepositBalance += collection
            .verificationFeeBalance;
        _collectionsDepositBalance -= collection.verificationFeeBalance;
        collection.visible = false;
        collection.verified = false;
        emit CollectionBlacklisted(collectionAddress);
    }

    function removeCollection(
        address collectionAddress
    ) external whenNotPaused {
        uint256 index = _collectionByAddressIndex[collectionAddress];
        if (index == 0) {
            revert CollectionDoesNotExist(collectionAddress);
        }
        index -= 1;
        Collection memory collection = _collections[index];

        if (IOwnable(collection.collection).owner() != _msgSender())
            revert OnlyCollectionOwnerCanRemoveCollection();

        if (collection.legoCombination != LegoCombination.ERC1155) {
            if (IRMRKImplementationBase(collectionAddress).totalSupply() > 0) {
                revert CollectionHasMintedTokens();
            }
        }
        // TODO: Check for ERC1155

        _removeCollection(collectionAddress, index);
    }

    function forceRemoveCollection(
        address collectionAddress
    ) external onlyOwnerOrContributor {
        uint256 index = _collectionByAddressIndex[collectionAddress];
        if (index == 0) {
            revert CollectionDoesNotExist(collectionAddress);
        }
        index -= 1;
        _removeCollection(collectionAddress, index);
    }

    function _removeCollection(
        address collectionAddress,
        uint256 index
    ) private {
        Collection memory collection = _collections[index];

        delete _collections[index];
        delete _collectionByAddressIndex[collectionAddress];

        if (collection.verificationFeeBalance > 0) {
            uint256 refundBalance = collection.verificationFeeBalance;
            _collectionsDepositBalance -= refundBalance;
            rmrkToken.transfer(collection.verificationSponsor, refundBalance);
        }

        emit CollectionRemoved(collectionAddress);
    }

    function unblackListCollection(
        address collectionAddress
    ) external onlyOwnerOrContributor {
        Collection storage collection = _collections[
            _collectionByAddressIndex[collectionAddress] - 1
        ];
        collection.visible = true;
    }

    function withdrawFees(address to) external onlyOwner {
        uint256 feeAmount = _blacklistedCollectionsDepositBalance;
        _blacklistedCollectionsDepositBalance = 0;
        rmrkToken.transfer(to, feeAmount);
    }

    function getCollectionVerificationFee() external view returns (uint256) {
        return collectionVerificationFee;
    }

    function getRmrkTokenAddress() external view returns (address) {
        return address(rmrkToken);
    }

    function getTotalCollectionCount() external view returns (uint256) {
        return _collections.length;
    }

    function getMetaFactoryAddress() external view returns (address) {
        return metaFactoryAddress;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    function pauseRegistry(bool pause) external onlyOwnerOrContributor {
        _pause(pause);
    }

    // External collections

    function setCollectionAllowedPerIssuer(
        address issuer,
        string memory collectionSymbol,
        bool allowed
    ) external onlyOwnerOrContributor {
        if (bytes(collectionSymbol).length == 0) {
            revert CollectionSymbolCannotBeEmpty();
        }

        if (allowed) {
            _collectionsAllowedPerIssuer[issuer][collectionSymbol] = true;
        } else {
            delete _collectionsAllowedPerIssuer[issuer][collectionSymbol];
        }
    }

    function isCollectionAllowedForIssuer(
        address issuer,
        string memory collectionSymbol
    ) public view returns (bool) {
        if (bytes(collectionSymbol).length == 0) {
            revert CollectionSymbolCannotBeEmpty();
        }
        return
            !_isProduction ||
            _collectionsAllowedPerIssuer[issuer][_ALL_COLLECTIONS_ALLOWED] ||
            _collectionsAllowedPerIssuer[issuer][collectionSymbol];
    }

    function setProduction(bool isProduction_) external onlyOwnerOrContributor {
        _isProduction = isProduction_;
    }

    function isProduction() external view returns (bool) {
        return _isProduction;
    }
}
