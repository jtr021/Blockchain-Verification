// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;


contract DataInt {
    enum StorageType { Centralized, IPFS }

   struct Data {
        StorageType storageType;
        bytes32 pointer;
        bytes32 checksum;
        uint256 timestamp;
    }


    error InvalidStorageType();
    error EmptyId();
    error EmptyPointer();
    error ZeroChecksum();
    error DataExists();
    error DataNotFound();
    error NotOwner();

    address public immutable owner;

    mapping(bytes32 => Data) private dataRecords;

    event DataStored(
        bytes32 indexed id,
        StorageType storageType,
        bytes32 pointer,
        bytes32 checksum,
        uint256 timestamp
    );

    modifier onlyOwner(){
        if (msg.sender != owner) revert NotOwner();
        _;

    }

    constructor() {
        owner = msg.sender;
    }

    function storeData(bytes32 id, StorageType storageType_, bytes32 pointer_ ,bytes32 checksum
    ) external onlyOwner {
        if (id == bytes32(0)) revert EmptyId();
        if (storageType_ == StorageType.IPFS && pointer_ == bytes32(0)) revert EmptyPointer();
        if (checksum == bytes32(0)) revert ZeroChecksum();
        if (dataRecords[id].timestamp != 0) revert DataExists();
        dataRecords[id] = Data({
            pointer:      pointer_,
            checksum:     checksum,
            timestamp:    block.timestamp,
            storageType: storageType_
        });
        emit DataStored(id, StorageType(storageType_), pointer_, checksum, block.timestamp);
    }

    function getData(bytes32 id) external view returns (StorageType storageTypeFlag, bytes32 pointer, bytes32 checksum, uint256 timestamp) {
        Data storage d = dataRecords[id];
        if (d.timestamp == 0) revert DataNotFound();
        return (d.storageType, d.pointer, d.checksum, d.timestamp);
    }


    function verifyData(bytes32 id, bytes32 _checksum) public view returns (bool) {
        Data storage d = dataRecords[id];
        if (d.timestamp == 0) revert DataNotFound();
        return d.checksum == _checksum;
    }
}
