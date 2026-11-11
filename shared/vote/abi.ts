// Generated from vote/out/SignedBallots.sol/SignedBallots.json (forge build). Do not edit.
export const SIGNED_BALLOTS_ABI = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "admin",
        "type": "address",
        "internalType": "address",
      },
      {
        "name": "externalNFT",
        "type": "address",
        "internalType": "address",
      },
      {
        "name": "name_",
        "type": "string",
        "internalType": "string",
      },
      {
        "name": "symbol_",
        "type": "string",
        "internalType": "string",
      },
      {
        "name": "schedule",
        "type": "tuple",
        "internalType": "struct SignedBallots.Schedule",
        "components": [
          {
            "name": "opensAt",
            "type": "uint64",
            "internalType": "uint64",
          },
          {
            "name": "initialWindow",
            "type": "uint64",
            "internalType": "uint64",
          },
          {
            "name": "firstTallyAt",
            "type": "uint64[3]",
            "internalType": "uint64[3]",
          },
          {
            "name": "maxWindows",
            "type": "uint8",
            "internalType": "uint8",
          },
        ],
      },
    ],
    "stateMutability": "nonpayable",
  },
  {
    "type": "function",
    "name": "ADMIN_ROLE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "BLOB_SUBMITTER_ROLE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "DEFAULT_ADMIN_ROLE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "MAX_CURRENCIES",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "MAX_GROUPS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "MAX_PROJECTS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "MINTER_ROLE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "PLEDGE_ROLE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "USD",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "USD_SCALE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "VOTE_TYPEHASH",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "addGroup",
    "inputs": [
      {
        "name": "name",
        "type": "bytes32",
        "internalType": "bytes32",
      },
    ],
    "outputs": [
      {
        "name": "id",
        "type": "uint8",
        "internalType": "uint8",
      },
    ],
    "stateMutability": "nonpayable",
  },
  {
    "type": "function",
    "name": "addInitiative",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address",
      },
      {
        "name": "askUsd",
        "type": "uint256",
        "internalType": "uint256",
      },
      {
        "name": "rfp",
        "type": "bool",
        "internalType": "bool",
      },
      {
        "name": "groups",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "outputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "stateMutability": "nonpayable",
  },
  {
    "type": "function",
    "name": "approve",
    "inputs": [
      {
        "name": "to",
        "type": "address",
        "internalType": "address",
      },
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "outputs": [],
    "stateMutability": "nonpayable",
  },
  {
    "type": "function",
    "name": "balanceOf",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address",
      },
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "ballotHashOf",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "outputs": [
      {
        "name": "ballotHash",
        "type": "bytes32",
        "internalType": "bytes32",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "burn",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "outputs": [],
    "stateMutability": "nonpayable",
  },
  {
    "type": "function",
    "name": "currency",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct RoundAccounting.Currency",
        "components": [
          {
            "name": "asset",
            "type": "address",
            "internalType": "address",
          },
          {
            "name": "usdFeed",
            "type": "address",
            "internalType": "address",
          },
          {
            "name": "amountDecimals",
            "type": "uint8",
            "internalType": "uint8",
          },
          {
            "name": "feedDecimals",
            "type": "uint8",
            "internalType": "uint8",
          },
          {
            "name": "maxPriceAge",
            "type": "uint32",
            "internalType": "uint32",
          },
        ],
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "currencyCount",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "digestOf",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256",
      },
      {
        "name": "nonce",
        "type": "uint64",
        "internalType": "uint64",
      },
      {
        "name": "ballotHash",
        "type": "bytes32",
        "internalType": "bytes32",
      },
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "eip712Domain",
    "inputs": [],
    "outputs": [
      {
        "name": "fields",
        "type": "bytes1",
        "internalType": "bytes1",
      },
      {
        "name": "name",
        "type": "string",
        "internalType": "string",
      },
      {
        "name": "version",
        "type": "string",
        "internalType": "string",
      },
      {
        "name": "chainId",
        "type": "uint256",
        "internalType": "uint256",
      },
      {
        "name": "verifyingContract",
        "type": "address",
        "internalType": "address",
      },
      {
        "name": "salt",
        "type": "bytes32",
        "internalType": "bytes32",
      },
      {
        "name": "extensions",
        "type": "uint256[]",
        "internalType": "uint256[]",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "eligibilityNFT",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "firstTallyAt",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "getApproved",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "getRoleAdmin",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "internalType": "bytes32",
      },
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "grantRole",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "internalType": "bytes32",
      },
      {
        "name": "account",
        "type": "address",
        "internalType": "address",
      },
    ],
    "outputs": [],
    "stateMutability": "nonpayable",
  },
  {
    "type": "function",
    "name": "groupCount",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "groupName",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "hardDeadline",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "hasRegistrationReceipt",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "hasRole",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "internalType": "bytes32",
      },
      {
        "name": "account",
        "type": "address",
        "internalType": "address",
      },
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "independentTiers",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "initialWindow",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "initiative",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct RoundAccounting.Initiative",
        "components": [
          {
            "name": "account",
            "type": "address",
            "internalType": "address",
          },
          {
            "name": "rfp",
            "type": "bool",
            "internalType": "bool",
          },
          {
            "name": "askUsd",
            "type": "uint256",
            "internalType": "uint256",
          },
          {
            "name": "groups",
            "type": "uint256",
            "internalType": "uint256",
          },
        ],
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "initiativeCount",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "initiativeCurrencyAmounts",
    "inputs": [
      {
        "name": "initiativeId",
        "type": "uint256",
        "internalType": "uint256",
      },
      {
        "name": "currencyId",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "outputs": [
      {
        "name": "donated",
        "type": "uint256",
        "internalType": "uint256",
      },
      {
        "name": "pledged",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "initiativeUsd",
    "inputs": [
      {
        "name": "initiativeId",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "outputs": [
      {
        "name": "donatedUsd",
        "type": "uint256",
        "internalType": "uint256",
      },
      {
        "name": "pledgedUsd",
        "type": "uint256",
        "internalType": "uint256",
      },
      {
        "name": "totalUsd",
        "type": "uint256",
        "internalType": "uint256",
      },
      {
        "name": "remainingAskUsd",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "isApprovedForAll",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address",
      },
      {
        "name": "operator",
        "type": "address",
        "internalType": "address",
      },
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "latestSettlementAt",
    "inputs": [
      {
        "name": "tier",
        "type": "uint8",
        "internalType": "uint8",
      },
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "maxWindows",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "maximumTierDuration",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "mint",
    "inputs": [
      {
        "name": "to",
        "type": "address",
        "internalType": "address",
      },
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "outputs": [],
    "stateMutability": "nonpayable",
  },
  {
    "type": "function",
    "name": "name",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "string",
        "internalType": "string",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "nonceOf",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "outputs": [
      {
        "name": "nonce",
        "type": "uint64",
        "internalType": "uint64",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "opensAt",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "ownerOf",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "pledgedAmount",
    "inputs": [
      {
        "name": "initiativeId",
        "type": "uint256",
        "internalType": "uint256",
      },
      {
        "name": "currencyId",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "outputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "pledges",
    "inputs": [
      {
        "name": "pledgeId",
        "type": "bytes32",
        "internalType": "bytes32",
      },
    ],
    "outputs": [
      {
        "name": "initiativeId",
        "type": "uint256",
        "internalType": "uint256",
      },
      {
        "name": "currencyId",
        "type": "uint256",
        "internalType": "uint256",
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256",
      },
      {
        "name": "exists",
        "type": "bool",
        "internalType": "bool",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "poolInitialized",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "poolUsd",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "projectCount",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "quoteUsd",
    "inputs": [
      {
        "name": "currencyId",
        "type": "uint256",
        "internalType": "uint256",
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "record",
    "inputs": [
      {
        "name": "votes",
        "type": "tuple[]",
        "internalType": "struct SignedBallots.Vote[]",
        "components": [
          {
            "name": "tokenId",
            "type": "uint256",
            "internalType": "uint256",
          },
          {
            "name": "nonce",
            "type": "uint64",
            "internalType": "uint64",
          },
          {
            "name": "r",
            "type": "bytes32",
            "internalType": "bytes32",
          },
          {
            "name": "vs",
            "type": "bytes32",
            "internalType": "bytes32",
          },
          {
            "name": "ballot",
            "type": "bytes",
            "internalType": "bytes",
          },
          {
            "name": "proof",
            "type": "uint8[]",
            "internalType": "uint8[]",
          },
        ],
      },
    ],
    "outputs": [],
    "stateMutability": "nonpayable",
  },
  {
    "type": "function",
    "name": "recordBlob",
    "inputs": [
      {
        "name": "blobIndex",
        "type": "uint256",
        "internalType": "uint256",
      },
      {
        "name": "votes",
        "type": "tuple[]",
        "internalType": "struct SignedBallots.BlobVote[]",
        "components": [
          {
            "name": "tokenId",
            "type": "uint256",
            "internalType": "uint256",
          },
          {
            "name": "nonce",
            "type": "uint64",
            "internalType": "uint64",
          },
          {
            "name": "r",
            "type": "bytes32",
            "internalType": "bytes32",
          },
          {
            "name": "vs",
            "type": "bytes32",
            "internalType": "bytes32",
          },
          {
            "name": "ballotHash",
            "type": "bytes32",
            "internalType": "bytes32",
          },
        ],
      },
    ],
    "outputs": [],
    "stateMutability": "nonpayable",
  },
  {
    "type": "function",
    "name": "recordCount",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "recordFor",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256",
      },
      {
        "name": "nonce",
        "type": "uint64",
        "internalType": "uint64",
      },
      {
        "name": "ballot",
        "type": "bytes",
        "internalType": "bytes",
      },
      {
        "name": "signature",
        "type": "bytes",
        "internalType": "bytes",
      },
      {
        "name": "proof",
        "type": "uint8[]",
        "internalType": "uint8[]",
      },
    ],
    "outputs": [],
    "stateMutability": "nonpayable",
  },
  {
    "type": "function",
    "name": "registerCurrency",
    "inputs": [
      {
        "name": "asset",
        "type": "address",
        "internalType": "address",
      },
      {
        "name": "usdFeed",
        "type": "address",
        "internalType": "address",
      },
      {
        "name": "maxPriceAge",
        "type": "uint32",
        "internalType": "uint32",
      },
    ],
    "outputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "stateMutability": "nonpayable",
  },
  {
    "type": "function",
    "name": "registrationDeadline",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "registrationReceiptCount",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "renounceRole",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "internalType": "bytes32",
      },
      {
        "name": "callerConfirmation",
        "type": "address",
        "internalType": "address",
      },
    ],
    "outputs": [],
    "stateMutability": "nonpayable",
  },
  {
    "type": "function",
    "name": "revokeRole",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "internalType": "bytes32",
      },
      {
        "name": "account",
        "type": "address",
        "internalType": "address",
      },
    ],
    "outputs": [],
    "stateMutability": "nonpayable",
  },
  {
    "type": "function",
    "name": "safeTransferFrom",
    "inputs": [
      {
        "name": "from",
        "type": "address",
        "internalType": "address",
      },
      {
        "name": "to",
        "type": "address",
        "internalType": "address",
      },
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "outputs": [],
    "stateMutability": "nonpayable",
  },
  {
    "type": "function",
    "name": "safeTransferFrom",
    "inputs": [
      {
        "name": "from",
        "type": "address",
        "internalType": "address",
      },
      {
        "name": "to",
        "type": "address",
        "internalType": "address",
      },
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256",
      },
      {
        "name": "data",
        "type": "bytes",
        "internalType": "bytes",
      },
    ],
    "outputs": [],
    "stateMutability": "nonpayable",
  },
  {
    "type": "function",
    "name": "setApprovalForAll",
    "inputs": [
      {
        "name": "operator",
        "type": "address",
        "internalType": "address",
      },
      {
        "name": "approved",
        "type": "bool",
        "internalType": "bool",
      },
    ],
    "outputs": [],
    "stateMutability": "nonpayable",
  },
  {
    "type": "function",
    "name": "setBaseURI",
    "inputs": [
      {
        "name": "baseURI",
        "type": "string",
        "internalType": "string",
      },
    ],
    "outputs": [],
    "stateMutability": "nonpayable",
  },
  {
    "type": "function",
    "name": "setDates",
    "inputs": [
      {
        "name": "opensAt_",
        "type": "uint64",
        "internalType": "uint64",
      },
      {
        "name": "firstTallyAt_",
        "type": "uint64[3]",
        "internalType": "uint64[3]",
      },
    ],
    "outputs": [],
    "stateMutability": "nonpayable",
  },
  {
    "type": "function",
    "name": "setIndependentTiers",
    "inputs": [
      {
        "name": "mask",
        "type": "uint8",
        "internalType": "uint8",
      },
    ],
    "outputs": [],
    "stateMutability": "nonpayable",
  },
  {
    "type": "function",
    "name": "setInitiative",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256",
      },
      {
        "name": "account",
        "type": "address",
        "internalType": "address",
      },
      {
        "name": "askUsd",
        "type": "uint256",
        "internalType": "uint256",
      },
      {
        "name": "rfp",
        "type": "bool",
        "internalType": "bool",
      },
      {
        "name": "groups",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "outputs": [],
    "stateMutability": "nonpayable",
  },
  {
    "type": "function",
    "name": "setPledge",
    "inputs": [
      {
        "name": "pledgeId",
        "type": "bytes32",
        "internalType": "bytes32",
      },
      {
        "name": "initiativeId",
        "type": "uint256",
        "internalType": "uint256",
      },
      {
        "name": "currencyId",
        "type": "uint256",
        "internalType": "uint256",
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "outputs": [],
    "stateMutability": "nonpayable",
  },
  {
    "type": "function",
    "name": "setPoolUsd",
    "inputs": [
      {
        "name": "amountUsd",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "outputs": [],
    "stateMutability": "nonpayable",
  },
  {
    "type": "function",
    "name": "supportsInterface",
    "inputs": [
      {
        "name": "interfaceId",
        "type": "bytes4",
        "internalType": "bytes4",
      },
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "symbol",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "string",
        "internalType": "string",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "tokenURI",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "outputs": [
      {
        "name": "",
        "type": "string",
        "internalType": "string",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "transcript",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "transferFrom",
    "inputs": [
      {
        "name": "from",
        "type": "address",
        "internalType": "address",
      },
      {
        "name": "to",
        "type": "address",
        "internalType": "address",
      },
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "outputs": [],
    "stateMutability": "nonpayable",
  },
  {
    "type": "function",
    "name": "vote",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256",
      },
      {
        "name": "nonce",
        "type": "uint64",
        "internalType": "uint64",
      },
      {
        "name": "ballot",
        "type": "bytes",
        "internalType": "bytes",
      },
      {
        "name": "proof",
        "type": "uint8[]",
        "internalType": "uint8[]",
      },
    ],
    "outputs": [],
    "stateMutability": "nonpayable",
  },
  {
    "type": "function",
    "name": "voterOwner",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "windowCutoff",
    "inputs": [
      {
        "name": "tier",
        "type": "uint8",
        "internalType": "uint8",
      },
      {
        "name": "window",
        "type": "uint8",
        "internalType": "uint8",
      },
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "function",
    "name": "windowDuration",
    "inputs": [
      {
        "name": "window",
        "type": "uint8",
        "internalType": "uint8",
      },
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64",
      },
    ],
    "stateMutability": "view",
  },
  {
    "type": "event",
    "name": "Approval",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address",
      },
      {
        "name": "approved",
        "type": "address",
        "indexed": true,
        "internalType": "address",
      },
      {
        "name": "tokenId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256",
      },
    ],
    "anonymous": false,
  },
  {
    "type": "event",
    "name": "ApprovalForAll",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address",
      },
      {
        "name": "operator",
        "type": "address",
        "indexed": true,
        "internalType": "address",
      },
      {
        "name": "approved",
        "type": "bool",
        "indexed": false,
        "internalType": "bool",
      },
    ],
    "anonymous": false,
  },
  {
    "type": "event",
    "name": "BallotRecorded",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256",
      },
      {
        "name": "voter",
        "type": "address",
        "indexed": true,
        "internalType": "address",
      },
      {
        "name": "nonce",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64",
      },
      {
        "name": "ballot",
        "type": "bytes",
        "indexed": false,
        "internalType": "bytes",
      },
    ],
    "anonymous": false,
  },
  {
    "type": "event",
    "name": "BlobBallotRecorded",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256",
      },
      {
        "name": "voter",
        "type": "address",
        "indexed": true,
        "internalType": "address",
      },
      {
        "name": "nonce",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64",
      },
      {
        "name": "ballotHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32",
      },
      {
        "name": "blobHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32",
      },
    ],
    "anonymous": false,
  },
  {
    "type": "event",
    "name": "CurrencyRegistered",
    "inputs": [
      {
        "name": "currencyId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256",
      },
      {
        "name": "asset",
        "type": "address",
        "indexed": true,
        "internalType": "address",
      },
      {
        "name": "usdFeed",
        "type": "address",
        "indexed": false,
        "internalType": "address",
      },
      {
        "name": "amountDecimals",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8",
      },
      {
        "name": "feedDecimals",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8",
      },
      {
        "name": "maxPriceAge",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32",
      },
    ],
    "anonymous": false,
  },
  {
    "type": "event",
    "name": "EIP712DomainChanged",
    "inputs": [],
    "anonymous": false,
  },
  {
    "type": "event",
    "name": "EligibilityConfigured",
    "inputs": [
      {
        "name": "collection",
        "type": "address",
        "indexed": true,
        "internalType": "address",
      },
    ],
    "anonymous": false,
  },
  {
    "type": "event",
    "name": "GroupAdded",
    "inputs": [
      {
        "name": "id",
        "type": "uint8",
        "indexed": true,
        "internalType": "uint8",
      },
      {
        "name": "name",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32",
      },
    ],
    "anonymous": false,
  },
  {
    "type": "event",
    "name": "InitiativeConfigured",
    "inputs": [
      {
        "name": "initiativeId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256",
      },
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address",
      },
      {
        "name": "askUsd",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256",
      },
      {
        "name": "rfp",
        "type": "bool",
        "indexed": false,
        "internalType": "bool",
      },
      {
        "name": "groups",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256",
      },
    ],
    "anonymous": false,
  },
  {
    "type": "event",
    "name": "MetadataBaseURISet",
    "inputs": [
      {
        "name": "baseURI",
        "type": "string",
        "indexed": false,
        "internalType": "string",
      },
    ],
    "anonymous": false,
  },
  {
    "type": "event",
    "name": "PledgeSet",
    "inputs": [
      {
        "name": "pledgeId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32",
      },
      {
        "name": "initiativeId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256",
      },
      {
        "name": "currencyId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256",
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256",
      },
    ],
    "anonymous": false,
  },
  {
    "type": "event",
    "name": "PoolUsdSet",
    "inputs": [
      {
        "name": "previousAmountUsd",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256",
      },
      {
        "name": "amountUsd",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256",
      },
    ],
    "anonymous": false,
  },
  {
    "type": "event",
    "name": "RegistrationReceipt",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256",
      },
    ],
    "anonymous": false,
  },
  {
    "type": "event",
    "name": "RegistrationRevoked",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256",
      },
    ],
    "anonymous": false,
  },
  {
    "type": "event",
    "name": "RoleAdminChanged",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32",
      },
      {
        "name": "previousAdminRole",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32",
      },
      {
        "name": "newAdminRole",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32",
      },
    ],
    "anonymous": false,
  },
  {
    "type": "event",
    "name": "RoleGranted",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32",
      },
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address",
      },
      {
        "name": "sender",
        "type": "address",
        "indexed": true,
        "internalType": "address",
      },
    ],
    "anonymous": false,
  },
  {
    "type": "event",
    "name": "RoleRevoked",
    "inputs": [
      {
        "name": "role",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32",
      },
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address",
      },
      {
        "name": "sender",
        "type": "address",
        "indexed": true,
        "internalType": "address",
      },
    ],
    "anonymous": false,
  },
  {
    "type": "event",
    "name": "ScheduleConfigured",
    "inputs": [
      {
        "name": "opensAt",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64",
      },
      {
        "name": "initialWindow",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64",
      },
      {
        "name": "firstTallyAt",
        "type": "uint64[3]",
        "indexed": false,
        "internalType": "uint64[3]",
      },
      {
        "name": "maxWindows",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8",
      },
      {
        "name": "registrationDeadline",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64",
      },
      {
        "name": "hardDeadline",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64",
      },
    ],
    "anonymous": false,
  },
  {
    "type": "event",
    "name": "Transfer",
    "inputs": [
      {
        "name": "from",
        "type": "address",
        "indexed": true,
        "internalType": "address",
      },
      {
        "name": "to",
        "type": "address",
        "indexed": true,
        "internalType": "address",
      },
      {
        "name": "tokenId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256",
      },
    ],
    "anonymous": false,
  },
  {
    "type": "error",
    "name": "AccessControlBadConfirmation",
    "inputs": [],
  },
  {
    "type": "error",
    "name": "AccessControlUnauthorizedAccount",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address",
      },
      {
        "name": "neededRole",
        "type": "bytes32",
        "internalType": "bytes32",
      },
    ],
  },
  {
    "type": "error",
    "name": "AddingClosed",
    "inputs": [],
  },
  {
    "type": "error",
    "name": "BadProof",
    "inputs": [
      {
        "name": "tier",
        "type": "uint8",
        "internalType": "uint8",
      },
    ],
  },
  {
    "type": "error",
    "name": "BallotTooSmall",
    "inputs": [],
  },
  {
    "type": "error",
    "name": "ConfigurationFrozen",
    "inputs": [],
  },
  {
    "type": "error",
    "name": "DateAlreadyStarted",
    "inputs": [],
  },
  {
    "type": "error",
    "name": "DuplicateCurrency",
    "inputs": [],
  },
  {
    "type": "error",
    "name": "DuplicateInitiative",
    "inputs": [],
  },
  {
    "type": "error",
    "name": "ERC721IncorrectOwner",
    "inputs": [
      {
        "name": "sender",
        "type": "address",
        "internalType": "address",
      },
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256",
      },
      {
        "name": "owner",
        "type": "address",
        "internalType": "address",
      },
    ],
  },
  {
    "type": "error",
    "name": "ERC721InsufficientApproval",
    "inputs": [
      {
        "name": "operator",
        "type": "address",
        "internalType": "address",
      },
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
  },
  {
    "type": "error",
    "name": "ERC721InvalidApprover",
    "inputs": [
      {
        "name": "approver",
        "type": "address",
        "internalType": "address",
      },
    ],
  },
  {
    "type": "error",
    "name": "ERC721InvalidOperator",
    "inputs": [
      {
        "name": "operator",
        "type": "address",
        "internalType": "address",
      },
    ],
  },
  {
    "type": "error",
    "name": "ERC721InvalidOwner",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address",
      },
    ],
  },
  {
    "type": "error",
    "name": "ERC721InvalidReceiver",
    "inputs": [
      {
        "name": "receiver",
        "type": "address",
        "internalType": "address",
      },
    ],
  },
  {
    "type": "error",
    "name": "ERC721InvalidSender",
    "inputs": [
      {
        "name": "sender",
        "type": "address",
        "internalType": "address",
      },
    ],
  },
  {
    "type": "error",
    "name": "ERC721NonexistentToken",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
  },
  {
    "type": "error",
    "name": "ExternalCollection",
    "inputs": [],
  },
  {
    "type": "error",
    "name": "GroupOverHalf",
    "inputs": [
      {
        "name": "tier",
        "type": "uint8",
        "internalType": "uint8",
      },
      {
        "name": "group",
        "type": "uint8",
        "internalType": "uint8",
      },
    ],
  },
  {
    "type": "error",
    "name": "InitialFundingTooLate",
    "inputs": [],
  },
  {
    "type": "error",
    "name": "InvalidAddress",
    "inputs": [],
  },
  {
    "type": "error",
    "name": "InvalidBallot",
    "inputs": [],
  },
  {
    "type": "error",
    "name": "InvalidCurrency",
    "inputs": [],
  },
  {
    "type": "error",
    "name": "InvalidNFTCollection",
    "inputs": [],
  },
  {
    "type": "error",
    "name": "InvalidNonce",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256",
      },
      {
        "name": "nonce",
        "type": "uint64",
        "internalType": "uint64",
      },
    ],
  },
  {
    "type": "error",
    "name": "InvalidPledgeId",
    "inputs": [],
  },
  {
    "type": "error",
    "name": "InvalidPrice",
    "inputs": [
      {
        "name": "currencyId",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
  },
  {
    "type": "error",
    "name": "InvalidSchedule",
    "inputs": [],
  },
  {
    "type": "error",
    "name": "InvalidShortString",
    "inputs": [],
  },
  {
    "type": "error",
    "name": "InvalidSignature",
    "inputs": [],
  },
  {
    "type": "error",
    "name": "InvalidTiers",
    "inputs": [],
  },
  {
    "type": "error",
    "name": "NoBlob",
    "inputs": [],
  },
  {
    "type": "error",
    "name": "NoProjects",
    "inputs": [],
  },
  {
    "type": "error",
    "name": "NoVotes",
    "inputs": [],
  },
  {
    "type": "error",
    "name": "NotNFTOwner",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
  },
  {
    "type": "error",
    "name": "NotRegistered",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
  },
  {
    "type": "error",
    "name": "PoolCannotDecrease",
    "inputs": [],
  },
  {
    "type": "error",
    "name": "RegistrationClosed",
    "inputs": [],
  },
  {
    "type": "error",
    "name": "RfpWithGroups",
    "inputs": [],
  },
  {
    "type": "error",
    "name": "StalePrice",
    "inputs": [
      {
        "name": "currencyId",
        "type": "uint256",
        "internalType": "uint256",
      },
    ],
  },
  {
    "type": "error",
    "name": "StringTooLong",
    "inputs": [
      {
        "name": "str",
        "type": "string",
        "internalType": "string",
      },
    ],
  },
  {
    "type": "error",
    "name": "TooFewIndependent",
    "inputs": [
      {
        "name": "tier",
        "type": "uint8",
        "internalType": "uint8",
      },
    ],
  },
  {
    "type": "error",
    "name": "TooManyCurrencies",
    "inputs": [],
  },
  {
    "type": "error",
    "name": "TooManyGroups",
    "inputs": [],
  },
  {
    "type": "error",
    "name": "TooManyInitiatives",
    "inputs": [],
  },
  {
    "type": "error",
    "name": "TooManyTiers",
    "inputs": [],
  },
  {
    "type": "error",
    "name": "UnknownCurrency",
    "inputs": [],
  },
  {
    "type": "error",
    "name": "UnknownGroup",
    "inputs": [],
  },
  {
    "type": "error",
    "name": "UnknownInitiative",
    "inputs": [],
  },
  {
    "type": "error",
    "name": "VotingClosed",
    "inputs": [],
  },
  {
    "type": "error",
    "name": "VotingNotStarted",
    "inputs": [],
  },
  {
    "type": "error",
    "name": "WrongLength",
    "inputs": [],
  },
] as const;
