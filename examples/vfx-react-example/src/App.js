import React from 'react';
import { VfxClient, Network } from 'vfx-web-sdk';

function App() {
  const handleGenerateAccount = () => {
    try {
      console.log('Creating VfxClient with Network.Testnet...');
      const client = new VfxClient(Network.Testnet);
      console.log('✅ VfxClient initialized successfully:', client);

      // Test key generation
      const privateKey = client.generatePrivateKey();
      console.log('✅ Private key generated:', privateKey);

      const publicKey = client.publicFromPrivate(privateKey);
      console.log('✅ Public key derived:', publicKey);

      const address = client.addressFromPrivate(privateKey);
      console.log('✅ Address generated:', address);

    } catch (error) {
      console.error('❌ Error with VfxClient:', error);
      console.error('Error stack:', error.stack);
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>VFX Web SDK Browser Test</h1>
      <p>This example uses the browser-optimized build with no webpack configuration needed!</p>
      <button
        onClick={handleGenerateAccount}
      >
        Test VfxClient
      </button>
      <p style={{ marginTop: '20px', color: '#666' }}>
        Check the browser console for output!
      </p>
    </div>
  );
}

export default App;