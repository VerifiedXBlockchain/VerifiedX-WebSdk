export interface PaginatedResponse<T> {
    count: number;
    page: number;
    num_pages: number;
    results: T[];
}

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

export interface Transaction {
    hash: string
    height: number
    type: number
    type_label: string
    to_address: string
    from_address: string
    total_amount: number
    total_fee: number
    data: string | null
    date_crafted: string // ISO string
    signature: string
    nft: any
    unlock_time: string | null
    callback_details: any
    recovery_details: any
}

