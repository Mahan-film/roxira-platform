import { UploadStoreService } from './upload-store.service';
import { UPLOAD_TTL_MS } from '../constants/data-import.constants';

describe('UploadStoreService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('stores and retrieves an upload inside the same tenant', () => {
    const store = new UploadStoreService();
    store.save('tenant-1', 'upload-1', { headers: ['a'], rows: [['1']] });

    expect(store.get('tenant-1', 'upload-1')).toEqual(
      expect.objectContaining({ headers: ['a'], rows: [['1']] }),
    );
  });

  it('never returns another tenant upload even with the same uploadId', () => {
    const store = new UploadStoreService();
    store.save('tenant-1', 'upload-1', { headers: ['a'], rows: [['1']] });

    expect(store.get('tenant-2', 'upload-1')).toBeNull();
  });

  it('expires uploads after the 30 minute TTL', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-14T00:00:00Z'));

    const store = new UploadStoreService();
    store.save('tenant-1', 'upload-1', { headers: ['a'], rows: [['1']] });

    jest.setSystemTime(Date.now() + UPLOAD_TTL_MS + 1);
    expect(store.get('tenant-1', 'upload-1')).toBeNull();
  });

  it('removes an upload explicitly', () => {
    const store = new UploadStoreService();
    store.save('tenant-1', 'upload-1', { headers: ['a'], rows: [['1']] });
    store.remove('tenant-1', 'upload-1');

    expect(store.get('tenant-1', 'upload-1')).toBeNull();
  });
});
