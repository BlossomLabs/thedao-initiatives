import { keccak256, toHex } from "viem";

/** The vote contract's roles (RoundAccounting.sol): a round admin's wallet holds both. */
export const ADMIN_ROLE_ID = keccak256(toHex("ADMIN_ROLE"));
/** May sign pledges (setPledgeBySig). */
export const PLEDGE_ROLE_ID = keccak256(toHex("PLEDGE_ROLE"));
