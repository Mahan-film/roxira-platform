/**
 * تصاویر JPEG صفحه‌های یک PDF اسکن‌شده. رندر PDF در سرور ممکن نیست، ولی اسکنرها معمولاً هر صفحه را یک
 * شیء تصویر DCTDecode می‌گذارند و همان بایت‌ها یک JPEG کامل‌اند. روش‌های دیگر (JBIG2، CCITT) پشتیبانی نمی‌شوند.
 */

const MIN_PAGE_IMAGE_BYTES = 2048;
const MAX_DICTIONARY_BYTES = 2048;

/** تصویرها به ترتیب فایل؛ لوگوهای کوچک کنار گذاشته می‌شوند. `maxImages` سقف سخت است. */
export function extractPdfJpegs(pdf: Buffer, maxImages: number): Buffer[] {
  const images: Buffer[] = [];
  // Plain indexOf scans: a hostile file must stay linear, so there is no regex over the whole buffer.
  let from = 0;
  while (images.length < maxImages) {
    const keyword = pdf.indexOf('stream', from, 'latin1');
    if (keyword === -1) {
      break;
    }
    from = keyword + 6;
    if (pdf.toString('latin1', Math.max(0, keyword - 3), keyword) === 'end') {
      continue;
    }
    const dictionary = pdf.toString('latin1', Math.max(0, keyword - MAX_DICTIONARY_BYTES), keyword);
    const open = dictionary.lastIndexOf('obj');
    if (!dictionary.slice(open === -1 ? 0 : open).includes('/DCTDecode')) {
      continue;
    }
    let start = from;
    if (pdf[start] === 0x0d) start += 1;
    if (pdf[start] === 0x0a) start += 1;
    const end = pdf.indexOf('endstream', start, 'latin1');
    if (end === -1) {
      break;
    }
    from = end + 9;
    const image = pdf.subarray(start, end);
    if (image.length >= MIN_PAGE_IMAGE_BYTES && image[0] === 0xff && image[1] === 0xd8) {
      images.push(image);
    }
  }
  return images;
}
