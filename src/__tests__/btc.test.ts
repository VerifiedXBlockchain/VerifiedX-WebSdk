import KeypairService from '../btc/keypair';

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
