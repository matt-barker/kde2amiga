import { describe, it, expect } from 'vitest';
import { parseStoreProductId, ocsProductUrl, parseStoreProduct } from './storeUrl';

describe('parseStoreProductId', () => {
  it('takes the id from a store.kde.org product URL', () => {
    expect(parseStoreProductId('https://store.kde.org/p/2344960')).toBe('2344960');
  });

  it('takes the id from a pling.com product URL', () => {
    // store.kde.org and pling.com share one id space, and the kde-look OCS API
    // resolves ids from either, so a pasted pling link costs nothing to accept.
    expect(parseStoreProductId('https://www.pling.com/p/2234790/')).toBe('2234790');
  });

  it('ignores a trailing slash, query string and fragment', () => {
    expect(parseStoreProductId('https://store.kde.org/p/2344960/?foo=1#tab')).toBe('2344960');
  });

  it('rejects a URL from an unrelated host', () => {
    expect(parseStoreProductId('https://example.com/p/2344960')).toBeNull();
  });

  it('rejects a store URL that is not a product page', () => {
    expect(parseStoreProductId('https://store.kde.org/browse/cat/132')).toBeNull();
  });

  it('rejects text that is not a URL at all', () => {
    expect(parseStoreProductId('2344960')).toBeNull();
  });
});

describe('ocsProductUrl', () => {
  it('builds the OCS content endpoint for an id', () => {
    expect(ocsProductUrl('2344960')).toBe(
      'https://api.kde-look.org/ocs/v1/content/data/2344960?format=json',
    );
  });
});

/** Shaped like a real OCS reply, trimmed to the fields this module reads. */
function ocsReply(content: Record<string, unknown>) {
  return { status: 'ok', statuscode: 100, message: '', data: [content] };
}

describe('parseStoreProduct', () => {
  it('reads the name and the single download file', () => {
    const product = parseStoreProduct(
      ocsReply({
        id: '2344960',
        name: 'Slot-Silvery-Dark-Icons',
        downloadlink1: 'https://files06.pling.com/api/files/download/j/tok/Slot.tar.xz',
        downloadname1: 'Slot-Silvery-Dark-Icons.tar.xz',
        downloadsize1: '20224',
      }),
    );

    expect(product.name).toBe('Slot-Silvery-Dark-Icons');
    expect(product.files).toEqual([
      {
        name: 'Slot-Silvery-Dark-Icons.tar.xz',
        url: 'https://files06.pling.com/api/files/download/j/tok/Slot.tar.xz',
        sizeKb: 20224,
      },
    ]);
  });

  it('reads every download slot of a multi-variant product, in slot order', () => {
    const product = parseStoreProduct(
      ocsReply({
        name: 'Arcanum Icon theme',
        downloadlink1: 'https://files.example/Blue.tar.xz',
        downloadname1: 'Arcanum-Blue.tar.xz',
        downloadsize1: '4200',
        downloadlink2: 'https://files.example/Green.tar.xz',
        downloadname2: 'Arcanum-Green.tar.xz',
        downloadsize2: '4210',
      }),
    );

    expect(product.files.map((f) => f.name)).toEqual([
      'Arcanum-Blue.tar.xz',
      'Arcanum-Green.tar.xz',
    ]);
  });

  it('orders slots numerically rather than by string, so slot 10 follows slot 9', () => {
    const content: Record<string, unknown> = { name: 'Besgnulinux' };
    for (const slot of [1, 9, 10]) {
      content[`downloadlink${slot}`] = `https://files.example/${slot}.tar.xz`;
      content[`downloadname${slot}`] = `variant-${slot}.tar.xz`;
      content[`downloadsize${slot}`] = '100';
    }

    const product = parseStoreProduct(ocsReply(content));

    expect(product.files.map((f) => f.name)).toEqual([
      'variant-1.tar.xz',
      'variant-9.tar.xz',
      'variant-10.tar.xz',
    ]);
  });

  it('falls back to the id as a name when a slot has no downloadname', () => {
    const product = parseStoreProduct(
      ocsReply({
        name: 'Nameless',
        downloadlink1: 'https://files.example/a.tar.xz',
        downloadname1: '',
        downloadsize1: '10',
      }),
    );

    expect(product.files[0].name).toBe('Download 1');
  });

  it('rejects the statuscode 999 the API returns for an unknown id', () => {
    // Not an HTTP error: the API answers 200 with a failed envelope and no data array.
    expect(() =>
      parseStoreProduct({ status: 'failed', statuscode: 999, message: 'unknown request' }),
    ).toThrow(/no product/i);
  });

  it('rejects a product that publishes no downloadable file', () => {
    expect(() => parseStoreProduct(ocsReply({ name: 'Empty' }))).toThrow(/no downloadable/i);
  });
});
