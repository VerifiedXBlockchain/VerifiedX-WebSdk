import { MediaApiClient } from '../client/media-api-client';
import { Network } from '../constants';
import * as fs from 'fs';
import * as path from 'path';

describe('MediaApiClient', () => {
  let mediaClient: MediaApiClient;

  beforeAll(() => {
    mediaClient = new MediaApiClient(Network.Testnet);
  });

  describe('uploadAsset', () => {
    test('should upload a file successfully', async () => {
      const testImagePath = path.join(__dirname, 'test-resources', 'media.jpg');

      // Check if test file exists
      expect(fs.existsSync(testImagePath)).toBe(true);

      // Read the file and create a File object
      const fileBuffer = fs.readFileSync(testImagePath);
      const file = new File([fileBuffer], 'media.jpg', { type: 'image/jpeg' });

      // Mock the makeMultipartRequest method to avoid actual API calls
      const mockResponse = { id: 'test-asset-id', url: 'https://example.com/test-asset' };
      jest.spyOn(mediaClient, 'makeMultipartRequest').mockResolvedValue(mockResponse);

      const result = await mediaClient.uploadAsset(file, {
        description: 'Test image upload',
        category: 'test'
      });

      expect(result).toEqual(mockResponse);
      expect(mediaClient.makeMultipartRequest).toHaveBeenCalledWith(
        '/',
        expect.any(FormData)
      );
    });

    test('should upload a file without metadata', async () => {
      const testImagePath = path.join(__dirname, 'test-resources', 'media.jpg');
      const fileBuffer = fs.readFileSync(testImagePath);
      const file = new File([fileBuffer], 'media.jpg', { type: 'image/jpeg' });

      const mockResponse = { id: 'test-asset-id-2' };
      jest.spyOn(mediaClient, 'makeMultipartRequest').mockResolvedValue(mockResponse);

      const result = await mediaClient.uploadAsset(file);

      expect(result).toEqual(mockResponse);
      expect(mediaClient.makeMultipartRequest).toHaveBeenCalledWith(
        '/',
        expect.any(FormData)
      );
    });

    test('should handle upload errors gracefully', async () => {
      const testImagePath = path.join(__dirname, 'test-resources', 'media.jpg');
      const fileBuffer = fs.readFileSync(testImagePath);
      const file = new File([fileBuffer], 'media.jpg', { type: 'image/jpeg' });

      // Mock an error response
      jest.spyOn(mediaClient, 'makeMultipartRequest').mockRejectedValue(new Error('Upload failed'));
      jest.spyOn(console, 'error').mockImplementation(() => { });

      const result = await mediaClient.uploadAsset(file);

      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalledWith('Upload failed:', expect.any(Error));

      // Restore console.error
      (console.error as jest.Mock).mockRestore();
    });
  });
});