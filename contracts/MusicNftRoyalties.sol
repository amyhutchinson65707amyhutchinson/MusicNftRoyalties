// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract MusicNftRoyalties is SepoliaConfig {
    struct EncryptedRoyalty {
        uint256 id;
        euint32 encryptedOwnerId;
        euint32 encryptedShare;
        euint32 encryptedNftId;
        uint256 timestamp;
    }
    
    struct DecryptedRoyalty {
        string ownerId;
        uint256 share;
        string nftId;
        bool isRevealed;
    }

    uint256 public royaltyCount;
    mapping(uint256 => EncryptedRoyalty) public encryptedRoyalties;
    mapping(uint256 => DecryptedRoyalty) public decryptedRoyalties;
    
    mapping(string => euint32) private encryptedNftRoyaltyCount;
    string[] private nftList;
    
    mapping(uint256 => uint256) private requestToRoyaltyId;
    
    event RoyaltySubmitted(uint256 indexed id, uint256 timestamp);
    event DistributionRequested(uint256 indexed id);
    event RoyaltyDistributed(uint256 indexed id);
    
    modifier onlyRightHolder(uint256 royaltyId) {
        _;
    }
    
    function submitEncryptedRoyalty(
        euint32 encryptedOwnerId,
        euint32 encryptedShare,
        euint32 encryptedNftId
    ) public {
        royaltyCount += 1;
        uint256 newId = royaltyCount;
        
        encryptedRoyalties[newId] = EncryptedRoyalty({
            id: newId,
            encryptedOwnerId: encryptedOwnerId,
            encryptedShare: encryptedShare,
            encryptedNftId: encryptedNftId,
            timestamp: block.timestamp
        });
        
        decryptedRoyalties[newId] = DecryptedRoyalty({
            ownerId: "",
            share: 0,
            nftId: "",
            isRevealed: false
        });
        
        emit RoyaltySubmitted(newId, block.timestamp);
    }
    
    function requestRoyaltyDistribution(uint256 royaltyId) public onlyRightHolder(royaltyId) {
        EncryptedRoyalty storage royalty = encryptedRoyalties[royaltyId];
        require(!decryptedRoyalties[royaltyId].isRevealed, "Already revealed");
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(royalty.encryptedOwnerId);
        ciphertexts[1] = FHE.toBytes32(royalty.encryptedShare);
        ciphertexts[2] = FHE.toBytes32(royalty.encryptedNftId);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.distributeRoyalty.selector);
        requestToRoyaltyId[reqId] = royaltyId;
        
        emit DistributionRequested(royaltyId);
    }
    
    function distributeRoyalty(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 royaltyId = requestToRoyaltyId[requestId];
        require(royaltyId != 0, "Invalid request");
        
        EncryptedRoyalty storage eRoyalty = encryptedRoyalties[royaltyId];
        DecryptedRoyalty storage dRoyalty = decryptedRoyalties[royaltyId];
        require(!dRoyalty.isRevealed, "Already revealed");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        (string memory ownerId, uint256 share, string memory nftId) = 
            abi.decode(cleartexts, (string, uint256, string));
        
        dRoyalty.ownerId = ownerId;
        dRoyalty.share = share;
        dRoyalty.nftId = nftId;
        dRoyalty.isRevealed = true;
        
        if (FHE.isInitialized(encryptedNftRoyaltyCount[dRoyalty.nftId]) == false) {
            encryptedNftRoyaltyCount[dRoyalty.nftId] = FHE.asEuint32(0);
            nftList.push(dRoyalty.nftId);
        }
        encryptedNftRoyaltyCount[dRoyalty.nftId] = FHE.add(
            encryptedNftRoyaltyCount[dRoyalty.nftId], 
            FHE.asEuint32(1)
        );
        
        emit RoyaltyDistributed(royaltyId);
    }
    
    function getDecryptedRoyalty(uint256 royaltyId) public view returns (
        string memory ownerId,
        uint256 share,
        string memory nftId,
        bool isRevealed
    ) {
        DecryptedRoyalty storage r = decryptedRoyalties[royaltyId];
        return (r.ownerId, r.share, r.nftId, r.isRevealed);
    }
    
    function getEncryptedNftRoyaltyCount(string memory nftId) public view returns (euint32) {
        return encryptedNftRoyaltyCount[nftId];
    }
    
    function requestNftRoyaltyCountDecryption(string memory nftId) public {
        euint32 count = encryptedNftRoyaltyCount[nftId];
        require(FHE.isInitialized(count), "NFT not found");
        
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(count);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptNftRoyaltyCount.selector);
        requestToRoyaltyId[reqId] = bytes32ToUint(keccak256(abi.encodePacked(nftId)));
    }
    
    function decryptNftRoyaltyCount(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 nftHash = requestToRoyaltyId[requestId];
        string memory nftId = getNftFromHash(nftHash);
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32 count = abi.decode(cleartexts, (uint32));
    }
    
    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }
    
    function getNftFromHash(uint256 hash) private view returns (string memory) {
        for (uint i = 0; i < nftList.length; i++) {
            if (bytes32ToUint(keccak256(abi.encodePacked(nftList[i]))) == hash) {
                return nftList[i];
            }
        }
        revert("NFT not found");
    }
    
    function calculateTotalRoyalties(string memory nftId) public view returns (uint256 total) {
        for (uint256 i = 1; i <= royaltyCount; i++) {
            if (decryptedRoyalties[i].isRevealed && 
                keccak256(abi.encodePacked(decryptedRoyalties[i].nftId)) == 
                keccak256(abi.encodePacked(nftId))) {
                total += decryptedRoyalties[i].share;
            }
        }
        return total;
    }
}