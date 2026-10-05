# Fungible Tokens: Issuing and Managing VFX20 Tokens

This guide walks through the full life of a fungible (VFX20) token with the VerifiedX Web SDK: deploying the contract, minting supply, moving it between holders, and the owner controls (pause, ban, ownership transfer, holder votes).

## Prerequisites

- `vfx-web-sdk` 3.4.0 or later
- A funded VFX address. Token operations pay only the ordinary network fee in VFX (a few thousandths of a VFX each); there is no deployment charge beyond that.
- Testnet is strongly recommended while learning: a ban cannot be undone, and a token cannot be deleted.

## How Tokens Work on VerifiedX

A VFX20 token is a smart contract deployed by its owner. Its identifier, the `scIdentifier` (for example `9dbadf6ca06b4b75ac8594ca4de52cba:1791216037`), is what every later call is addressed to.

- **The owner** deploys, mints (if the token is mintable), pauses, bans, transfers ownership and opens votes.
- **Holders** transfer, burn their own balance (if the token is burnable) and vote.
- **Supply** is either fixed at deployment or mintable. A mintable token starts at zero and the owner mints into existence what is needed.
- Validation happens on chain. Spyglass, the VerifiedX explorer, indexes the result, and the SDK reads token state from it.

## Step 1: Set Up a Client and Keypair

```typescript
import { VfxClient, Network } from 'vfx-web-sdk';

const client = new VfxClient(Network.Testnet);

const privateKey = process.env.VFX_PRIVATE_KEY!;
const owner = {
  privateKey,
  publicKey: client.publicFromPrivate(privateKey),
  address: client.addressFromPrivate(privateKey),
};
```

Every method below also accepts a `Signer` in place of the keypair, so the key can live in an HSM or MPC service. See [External Signing](./external-signing.md).

## Step 2: Deploy the Token

```typescript
const deployed = await client.deployToken(owner, {
  name: 'Acme Fund',
  ticker: 'ACME',         // up to 20 characters, stored upper-case
  decimalPlaces: 2,       // 1–18, default 8
  mintable: true,
  burnable: true,
  // initialSupply: 1_000_000,  // whole tokens, for a fixed-supply token (must be 0 when mintable)
  // voting: true,              // enables holder votes
  // image: { url: 'https://example.com/acme.png' }, // optional, must be publicly fetchable
});

if (!deployed) throw new Error('Deploy was rejected before reaching the node');
const { scIdentifier, transactionHash } = deployed;
```

The `scIdentifier` is returned as soon as the contract compiles, before the transaction is confirmed. Store it: it is the token's permanent identifier.

Without an `image`, the network assigns a default token image.

## Step 3: Wait for Confirmation

Mutating methods return the transaction hash once the node accepts the transaction. Blocks arrive roughly every 10 seconds, and Spyglass indexes them shortly after. Before acting on a result, confirm it by reading state back:

```typescript
async function waitForToken(scIdentifier: string) {
  for (let i = 0; i < 30; i++) {
    try {
      const { token } = await client.getFungibleToken(scIdentifier);
      return token;
    } catch {
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  throw new Error(`Token ${scIdentifier} not indexed yet`);
}

const token = await waitForToken(scIdentifier);
console.log(token.owner_address, token.can_mint, token.is_paused);
```

The same applies between dependent steps: mint, wait until the balance shows, then transfer.

## Step 4: Mint, Transfer and Burn

```typescript
// Owner only, token must be mintable. Tokens are credited to the signer.
await client.mintToken(owner, { scIdentifier, amount: 10 });

// Any holder.
await client.transferToken(owner, { scIdentifier, toAddress: 'xRecipient...', amount: 3 });

// Any holder, from their own balance. Token must be burnable; there is no issuer-side burn.
await client.burnToken(owner, { scIdentifier, amount: 2 });
```

Each transaction carries the token's ticker and name for indexers and wallets. Pass `ticker` and `name` to skip the Spyglass lookup the SDK otherwise makes:

```typescript
await client.transferToken(owner, { scIdentifier, toAddress, amount: 1, ticker: 'ACME', name: 'Acme Fund' });
```

## Step 5: Read Balances and Holders

```typescript
// Every token an address holds
const balances = await client.getFungibleTokenBalances(owner.address);
// [{ token: { sc_identifier, ticker, ... }, balance: 5 }]

// One token, with its holder map
const { token, holders } = await client.getFungibleToken(scIdentifier);
// holders: { 'xOwner...': 5, 'xRecipient...': 3 }

// Browse all tokens
const page = await client.listFungibleTokens(1, 25);
```

## Step 6: Owner Controls

### Pause and Resume

```typescript
await client.toggleTokenPause(owner, { scIdentifier }); // active -> paused
// ...later
await client.toggleTokenPause(owner, { scIdentifier }); // paused -> active
```

Pause is a **toggle**: the network flips the current state. Send it once per intended change and confirm `is_paused` before sending again, because a second toggle undoes the first. The SDK reads the current state before sending, so the transaction is labelled with the state it produces (which explorers and wallets display).

### Ban an Address

```typescript
await client.banTokenAddress(owner, { scIdentifier, address: 'xBadActor...' });
```

A banned address can no longer send the token, but it can still receive. **The network has no way to lift a ban**, so treat it as permanent.

### Transfer Ownership

```typescript
await client.transferTokenOwnership(owner, { scIdentifier, toAddress: 'xNewOwner...' });
```

## Step 7: Holder Votes

For tokens deployed with `voting: true`, the owner opens a topic and holders vote:

```typescript
await client.createTokenVoteTopic(owner, {
  scIdentifier,
  name: 'Distribute Q3',
  description: 'Pay out the Q3 distribution',
  votingDays: 7,
  minimumVoteRequirement: 51,
});

const topics = await client.listTokenVotingTopics(scIdentifier);
await client.castTokenVote(holder, { scIdentifier, topicUid: topics.results[0].topic_id, vote: true });
```

## Dry Runs

A client created with `dryRun` builds, signs and has the node verify each transaction, then stops before sending. It is a safe way to check parameters on mainnet:

```typescript
const dry = new VfxClient(Network.Mainnet, true);
const check = await dry.deployToken(owner, { name: 'Acme Fund', ticker: 'ACME', initialSupply: 1_000_000 });
// check.scIdentifier and check.transactionHash are returned; nothing is broadcast
```

## Reserve Accounts and Tokens

Token methods can be signed from a reserve (vault) account and accept `unlockHours`. Note that a token transfer from a vault carries the unlock time the network requires but **settles immediately**: a vault protects VFX, vBTC and NFTs, not fungible tokens. Deploying a token from a vault is refused. See [Reserve Accounts](./reserve-accounts.md).

## Common Issues

### `A non-mintable token with initialSupply 0 could never have any supply`
Set `mintable: true`, or give a fixed-supply token an `initialSupply`.

### Mint or transfer rejected right after deploy
The deploy is not confirmed yet. Wait until `getFungibleToken` returns the token.

### Transfer rejected for a holder
The token may be paused, or the sender banned. Check `is_paused` and `banned_addresses` on `getFungibleToken`.

## What's Next?

- [External Signing](./external-signing.md): keep the issuer key in an HSM or MPC service
- [Reserve Accounts](./reserve-accounts.md): time-delayed, recoverable treasury accounts
- [VfxClient API Reference](../api/vfx-client.md): every token method and its parameters
