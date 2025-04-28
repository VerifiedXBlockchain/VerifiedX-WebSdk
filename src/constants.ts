
export enum TxType {
    RbxTransfer = 0,
    Node = 1,
    NftMint = 2,
    NftTx = 3,
    NftBurn = 4,
    NftSale = 5,
    Adnr = 6,
    DstShop = 7,
    VoteTopic = 8,
    Vote = 9,
    Reserve = 10,
    TokenTx = 15,
    TokenDeploy = 17,
    TokenizeTx = 18,
}

export enum Network {
    Mainnet = 'mainnet',
    Testnet = 'testnet',
}

export const DOMAIN_PURCHASE_COST = 5.0;
export const DOMAIN_TRANSFER_COST = 5.0;
export const DOMAIN_DELETE_COST = 5.0;

