import KeypairService from '../btc/keypair';
import TransactionService from '../btc/transaction';
import AccountService from '../btc/account';
import { BTC_TO_SATOSHI_MULTIPLIER, SATOSHI_TO_BTC_MULTIPLIER } from '../btc/constants';

describe('Keypairs', () => {
  let keypairService: KeypairService;

  beforeAll(() => {
    keypairService = new KeypairService(true);
  });

  test('can generate random keypair', () => {
    const data = keypairService.keypairFromRandom();
    expect(data).toBeTruthy();
  });

  test('keypair has address, wif, privateKey, and publicKey', () => {
    const { address, wif, privateKey, publicKey } = keypairService.keypairFromRandom();

    expect(address).toBeTruthy();
    expect(wif).toBeTruthy();
    expect(privateKey).toBeTruthy();
    expect(publicKey).toBeTruthy();
  });

  test('can generate random mnumonic', () => {
    const data = keypairService.keypairFromRandomMnemonic();
    expect(data).toBeTruthy();
  });

  test('random mnumonic has address, wif, privateKey, publicKey, and mnumonic', () => {
    const { address, wif, privateKey, publicKey, mnemonic } = keypairService.keypairFromRandomMnemonic();
    expect(address).toBeTruthy();
    expect(wif).toBeTruthy();
    expect(privateKey).toBeTruthy();
    expect(publicKey).toBeTruthy();
    expect(mnemonic).toBeTruthy();
  });

  test('mnumonic generates correct address', () => {
    const data = keypairService.keypairFromMnemonic("entire taste skull already invest view turtle surge razor key next buffalo venue canoe sheriff winner wash ten subject hamster scrap unit shield garden", 0);
    expect(data).toBeTruthy();
    expect(data.address).toEqual("tb1qkh6v5vgl9307ukuxzg6h8frsm8azr0vq5ye8r9")
  });

  test('can generate correct address from wif', () => {
    const data = keypairService.keypairFromWif("cPQ5kbnuj8YmBoCaFmsPsZENVykN1GGmF18mg6sEZsJPX2np6PRa");
    expect(data).toBeTruthy();
    expect(data.address).toEqual("tb1qh0nx4epkftfz3gmztkg9qmcyez604q36snzg0n")
  });

  test('can generate correct address from email password', () => {
    const data = keypairService.keypairFromEmailPassword("tyler@tylersavery.com", 'password123', 0);
    expect(data).toBeTruthy();
    expect(data.address).toEqual("tb1qag82uepw3jk5mhecyh6ntfgajk8h5wsu3732uz")
  });


  test('generates different addresses from different email/password combos', () => {
    const data = keypairService.keypairFromEmailPassword("tyler@tylersavery.com", 'password123', 0);
    expect(data).toBeTruthy();

    const data2 = keypairService.keypairFromEmailPassword("tyler2@tylersavery.com", 'password456', 0);
    expect(data2).toBeTruthy();
    expect(data.address == data2.address).toBeFalsy();
  });

  test('can sign message', () => {
    const message = "1728184267";
    const wif = "cRWtaDxTqXiY4mh7cTo9vMmnBkJcjGZCcdgncW2FnxuPogPchn4M";
    const expectedSig = "304402204e2284ccd24fbf44df54674a39c22ee9f4f10acc1e772c3c7eeea9b6f0e9c61e022024aa768aefb87a1c03408d31a3ce81b18ead75ee33e1c0213011f9ca3c806bf7.03dac7c36f74befdf45035315f6f733f3eeee1f9bab55303dd1db7f6914f8cc64c";

    const data = keypairService.signMessage(wif, message);
    expect(data).toBeTruthy();
    expect(data).toEqual(expectedSig);



  })


  test('can sign message with pkey', () => {
    const message = "1728184267";
    const privateKey = "75638430ff3634751efca0e334e66d0cb682ab0da06446b7cfae222efa1e8cb8";
    const expectedSig = "304402204e2284ccd24fbf44df54674a39c22ee9f4f10acc1e772c3c7eeea9b6f0e9c61e022024aa768aefb87a1c03408d31a3ce81b18ead75ee33e1c0213011f9ca3c806bf7.03dac7c36f74befdf45035315f6f733f3eeee1f9bab55303dd1db7f6914f8cc64c";

    const data = keypairService.signMessageWithPrivateKey(privateKey, message);
    expect(data).toBeTruthy();
    expect(data).toEqual(expectedSig);



  })


});



// describe('Transactions', () => {
//   let transactionService: TransactionService;

//   beforeAll(() => {
//     transactionService = new TransactionService(true);
//   });

//   test('can get feerates', async () => {

//     const feeRates = await transactionService.getFeeRates();
//     expect(feeRates).toBeTruthy();
//     expect(feeRates?.economyFee).toBeTruthy();
//   })

//   test('can create tx', async () => {

//     const senderWif = "cSfmWGVRGZhkMxAv8LSakPVX4FaC12Yp9oq6z3zyGsydh3KrArGw"
//     const recipientAddress = "tb1qr0eyx8j8w8u7n4vtvu6ywyk3smkhhexw42zrvm"
//     const amount = 0.000003

//     const data = await transactionService.createTransaction(senderWif, recipientAddress, amount);
//     expect(data.success).toEqual(true);

//     expect(data.result).toBeTruthy();
//   });

//   // test('can broadcast tx', async () => {
//   //   const senderWif = "cSfmWGVRGZhkMxAv8LSakPVX4FaC12Yp9oq6z3zyGsydh3KrArGw"
//   //   const recipientAddress = "tb1qr0eyx8j8w8u7n4vtvu6ywyk3smkhhexw42zrvm"
//   //   const amount = 0.000004

//   //   const createData = await transactionService.createTransaction(senderWif, recipientAddress, amount);
//   //   expect(createData.success).toEqual(true);

//   //   expect(createData.result).toBeTruthy();

//   //   const broadcastData = await transactionService.broadcastTransaction(createData.result!);

//   //   expect(broadcastData.success).toEqual(true)

//   //   expect(broadcastData.result).toBeTruthy()


//   // })


// });



// describe('Account', () => {
//   let accountService: AccountService;

//   beforeAll(() => {
//     accountService = new AccountService(true);
//   });

//   test('can get address info', async () => {

//     const address = "tb1qhra5rapluauvqjujcv752scfdmnf7h2afne4lr"

//     const data = await accountService.addressInfo(address);
//     expect(data).toBeTruthy();
//     expect(data.balance).toBeGreaterThanOrEqual(0);

//     await new Promise(resolve => setTimeout(resolve, 3000));

//   });

//   test('can get transactions', async () => {

//     const address = "tb1qhra5rapluauvqjujcv752scfdmnf7h2afne4lr"

//     const transactions = await accountService.transactions(address);
//     expect(transactions).toBeTruthy();
//     expect(transactions.length).toBeGreaterThan(0);


//   });

//   // test('can paginate txs', async () => {

//   //   const address = "tb1qh0nx4epkftfz3gmztkg9qmcyez604q36snzg0n"

//   //   const data = await accountService.transactions(address, 2);
//   //   expect(data).toBeTruthy();
//   //   expect(data.transactions.length).toBeGreaterThan(1);

//   //   const lastResult = data.transactions[data.transactions.length - 1];
//   //   const dataPage2 = await accountService.transactions(address, 2, lastResult.block_height);

//   //   await new Promise(resolve => setTimeout(resolve, 3000));


//   //   expect(dataPage2).toBeTruthy();
//   //   expect(dataPage2.transactions.length).toBeGreaterThan(1);

//   //   const page2lastResult = dataPage2.transactions[dataPage2.transactions.length - 1];

//   //   expect(page2lastResult.block_height).toBeLessThan(lastResult.block_height);

//   // });


// });