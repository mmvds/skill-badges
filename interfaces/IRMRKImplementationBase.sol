// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.21;

interface IRMRKImplementationBase {
    function name() external view returns (string memory);

    function symbol() external view returns (string memory);

    function totalSupply() external view returns (uint256);

    function maxSupply() external view returns (uint256);

    function collectionMetadata() external view returns (string memory);

    function contractURI() external view returns (string memory);
}
