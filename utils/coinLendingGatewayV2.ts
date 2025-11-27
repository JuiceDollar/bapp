// New contract deployed by backend team with enhanced features
import { Address } from "viem";
export const COIN_LENDING_GATEWAY_V2_ADDRESS: Record<number, Address> = {
  5115: "0xa85233C63b9Ee964Add6F2cffe00Fd84eb32338f", // Citrea Testnet
  62831: "0xa85233C63b9Ee964Add6F2cffe00Fd84eb32338f", // Citrea Mainnet - TODO: Update when deployed
};
export const CoinLendingGatewayV2ABI = [
    {
    inputs: [
      {
        internalType: 'address',
        name: '_mintingHub',
        type: 'address',
      },
      {
        internalType: 'address',
        name: '_wcbtc',
        type: 'address',
      },
      {
        internalType: 'address',
        name: '_jusd',
        type: 'address',
      },
    ],
    stateMutability: 'nonpayable',
    type: 'constructor',
  },

  {
    inputs: [],
    name: 'DirectCBTCNotAccepted',
    type: 'error',
  },
  {
    inputs: [],
    name: 'EnforcedPause',
    type: 'error',
  },
  {
    inputs: [],
    name: 'ExpectedPause',
    type: 'error',
  },
  {
    inputs: [],
    name: 'InsufficientCoin',
    type: 'error',
  },
  {
    inputs: [],
    name: 'InvalidPosition',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'owner',
        type: 'address',
      },
    ],
    name: 'OwnableInvalidOwner',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'account',
        type: 'address',
      },
    ],
    name: 'OwnableUnauthorizedAccount',
    type: 'error',
  },
  {
    inputs: [],
    name: 'PriceAdjustmentFailed',
    type: 'error',
  },
  {
    inputs: [],
    name: 'ReentrancyGuardReentrantCall',
    type: 'error',
  },
  {
    inputs: [],
    name: 'TransferFailed',
    type: 'error',
  },

  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'to',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'amount',
        type: 'uint256',
      },
    ],
    name: 'CoinRescued',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'previousOwner',
        type: 'address',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'newOwner',
        type: 'address',
      },
    ],
    name: 'OwnershipTransferred',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'address',
        name: 'account',
        type: 'address',
      },
    ],
    name: 'Paused',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'owner',
        type: 'address',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'position',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'coinAmount',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'mintAmount',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'liquidationPrice',
        type: 'uint256',
      },
    ],
    name: 'PositionCreatedWithCoin',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'token',
        type: 'address',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'to',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'amount',
        type: 'uint256',
      },
    ],
    name: 'TokenRescued',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'address',
        name: 'account',
        type: 'address',
      },
    ],
    name: 'Unpaused',
    type: 'event',
  },
  // View Functions
  {
    inputs: [],
    name: 'JUSD',
    outputs: [
      {
        internalType: 'contract IJuiceDollar',
        name: '',
        type: 'address',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'MINTING_HUB',
    outputs: [
      {
        internalType: 'contract IMintingHubGateway',
        name: '',
        type: 'address',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'WCBTC',
    outputs: [
      {
        internalType: 'contract IWrappedCBTC',
        name: '',
        type: 'address',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'owner',
    outputs: [
      {
        internalType: 'address',
        name: '',
        type: 'address',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'paused',
    outputs: [
      {
        internalType: 'bool',
        name: '',
        type: 'bool',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  // Main Functions
  {
    inputs: [
      {
        internalType: 'address',
        name: 'parent',
        type: 'address',
      },
      {
        internalType: 'uint256',
        name: 'initialMint',
        type: 'uint256',
      },
      {
        internalType: 'uint40',
        name: 'expiration',
        type: 'uint40',
      },
      {
        internalType: 'bytes32',
        name: 'frontendCode',
        type: 'bytes32',
      },
      {
        internalType: 'uint256',
        name: 'liquidationPrice',
        type: 'uint256',
      },
    ],
    name: 'lendWithCoin',
    outputs: [
      {
        internalType: 'address',
        name: 'position',
        type: 'address',
      },
    ],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'owner',
        type: 'address',
      },
      {
        internalType: 'address',
        name: 'parent',
        type: 'address',
      },
      {
        internalType: 'uint256',
        name: 'initialMint',
        type: 'uint256',
      },
      {
        internalType: 'uint40',
        name: 'expiration',
        type: 'uint40',
      },
      {
        internalType: 'bytes32',
        name: 'frontendCode',
        type: 'bytes32',
      },
      {
        internalType: 'uint256',
        name: 'liquidationPrice',
        type: 'uint256',
      },
    ],
    name: 'lendWithCoinFor',
    outputs: [
      {
        internalType: 'address',
        name: 'position',
        type: 'address',
      },
    ],
    stateMutability: 'payable',
    type: 'function',
  },
  // NEW: Add collateral with native coin
  {
    inputs: [
      {
        internalType: 'address',
        name: 'position',
        type: 'address',
      },
    ],
    name: 'addCollateralWithCoin',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  // NEW: Withdraw to native coin
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'amount',
        type: 'uint256',
      },
    ],
    name: 'withdrawToCoin',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // Admin Functions
  {
    inputs: [],
    name: 'pause',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'unpause',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'newOwner',
        type: 'address',
      },
    ],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'rescueCoin',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'token',
        type: 'address',
      },
      {
        internalType: 'address',
        name: 'to',
        type: 'address',
      },
      {
        internalType: 'uint256',
        name: 'amount',
        type: 'uint256',
      },
    ],
    name: 'rescueToken',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // Receive function
  {
    stateMutability: 'payable',
    type: 'receive',
  },
] as const;

