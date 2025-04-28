

export interface Keypair {
    privateKey: string
    publicKey: string
    address: string
}

export interface VfxAddress {
    address: string;
    balance: number;
    balanceTotal: number;
    balanceLocked: number;
    adnr: string | null;
    activated: boolean;
}