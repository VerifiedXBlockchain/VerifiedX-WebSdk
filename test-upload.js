const { MediaApiClient } = require('./lib/cjs/client/media-api-client');
const { Network } = require('./lib/cjs/constants');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

async function testUpload() {
  console.log('🚀 Starting media upload test...');

  try {
    // Initialize the MediaApiClient
    const mediaClient = new MediaApiClient(Network.Testnet);
    console.log('✅ MediaApiClient initialized');

    // Read the test image file
    const testImagePath = path.join(__dirname, 'src', '__tests__', 'test-resources', 'media.jpg');

    if (!fs.existsSync(testImagePath)) {
      console.error('❌ Test image file not found at:', testImagePath);
      return;
    }

    console.log('📁 Reading test file:', testImagePath);
    const fileStats = fs.statSync(testImagePath);

    console.log(`📊 File details:
    - Size: ${fileStats.size} bytes
    - Path: ${testImagePath}`);

    // Create FormData manually for Node.js
    const formData = new FormData();
    formData.append('file', fs.createReadStream(testImagePath), {
      filename: 'media.jpg',
      contentType: 'image/jpeg'
    });

    // Test metadata
    const metadata = {
      description: 'Test upload from Node.js script',
      category: 'test',
      timestamp: new Date().toISOString()
    };

    // Add metadata to FormData
    for (const key in metadata) {
      if (metadata.hasOwnProperty(key)) {
        formData.append(key, metadata[key]);
      }
    }

    console.log('📤 Uploading file with metadata:', metadata);

    // Use the lower-level makeMultipartRequest method directly
    const result = await mediaClient.makeMultipartRequest('/', formData);

    if (result) {
      console.log('✅ Upload successful!');
      console.log('📋 API Response:', JSON.stringify(result, null, 2));
    } else {
      console.log('❌ Upload failed - received null response');
    }

  } catch (error) {
    console.error('💥 Upload test failed with error:');
    console.error('Error details:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

// Run the test
testUpload()
  .then(() => {
    console.log('🏁 Test completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
  });