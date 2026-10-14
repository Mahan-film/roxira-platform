# ساخت اپلیکیشن اندروید قاضی هوشمند (TWA) و انتشار در کافه‌بازار و مایکت

## خلاصهٔ فارسی (برای مالک)

هدف این سند، تبدیل سایت `https://ghazihoushmand.ir` به یک اپلیکیشن اندروید از نوع
**Trusted Web Activity (TWA)** و انتشار آن در **کافه‌بازار** و **مایکت** است. کارهای
فنی سمت سایت انجام شده است:

- مانیفست PWA روی `https://ghazihoushmand.ir/manifest.webmanifest` سرو می‌شود (فقط روی دامنهٔ قاضی).
- Service Worker در `/sw.js` ثبت می‌شود و صفحهٔ آفلاین `/offline` موجود است.
- فایل تأیید مالکیت دامنه در `/.well-known/assetlinks.json` قرار گرفته و فقط باید **اثر انگشت SHA-256** کلید امضا در آن جایگزین شود.

کارهایی که **فقط مالک** می‌تواند انجام دهد و به هویت ایرانی و پرداخت نیاز دارد:

1. ساخت کلید امضا (keystore) و نگه‌داشتن امن آن.
2. ساخت اپ با Bubblewrap و تولید فایل `.aab`.
3. جایگزینی اثر انگشت SHA-256 در `assetlinks.json` و انتشار مجدد سایت.
4. ثبت‌نام حساب توسعه‌دهنده در کافه‌بازار و مایکت با **کد ملی/احراز هویت مالک** و بارگذاری اپ.

> توجه: اگر آیکون‌های موجود SVG هستند و Bubblewrap برای ساخت اپ به PNG نیاز داشت،
> پیش از `bubblewrap build` آیکون‌های PNG در اندازهٔ ۵۱۲×۵۱۲ (و ۱۹۲×۱۹۲) بسازید و
> مسیر آن‌ها را در مانیفست سایت جایگزین کنید (بخش «آیکون‌ها» را ببینید).

---

## پیش‌نیازها

- Node.js و npm روی ماشین مالک.
- JDK نسخهٔ ۱۷ یا جدیدتر (برای Gradle/Android SDK؛ Bubblewrap در اولین اجرا خودش درخواست نصب می‌کند).
- یک حساب کاربری در [کافه‌بازار](https://cafebazaar.ir) و [مایکت](https://myket.ir) (هر دو نیازمند احراز هویت ایرانی).
- دسترسی به فایل‌های پروژهٔ سایت برای ویرایش `assetlinks.json` و انتشار مجدد.

## گام ۱ — نصب Bubblewrap

```bash
npm i -g @bubblewrap/cli
bubblewrap --version
```

اگر از قبل نصب است، برای دریافت آخرین نسخه:

```bash
npm i -g @bubblewrap/cli@latest
```

## گام ۲ — مقداردهی اولیهٔ پروژهٔ اندروید

از مانیفست سایت، پکیج پایه ساخته می‌شود:

```bash
bubblewrap init --manifest https://ghazihoushmand.ir/manifest.webmanifest
```

در پاسخ به پرسش‌ها:

- **Application name**: «قاضی هوشمند»
- **Short name**: «قاضی هوشمند»
- **Application ID / package name**: `ir.ghazihoushmand.app`
  (این مقدار باید دقیقاً با `package_name` در `public/.well-known/assetlinks.json` یکسان باشد.)
- **Display mode**: `standalone`
- **Start URL**: `/chat?source=pwa`
- **Theme/Background color**: از مانیفست (`#1e3a8a` / `#020617`) خوانده می‌شود.
- **Signing key**: گزینهٔ «Create new keystore» را انتخاب کنید.

## گام ۳ — ساخت کلید امضا (keystore)

اگر در گام ۲ کلید نساخته‌اید:

```bash
bubblewrap build
```

Bubblewrap در اولین ساخت، keystore می‌سازد و رمز آن را می‌پرسد. **این فایل و رمزها
را در جای امن نگه دارید؛ بدون آن‌ها امکان به‌روزرسانی اپ در استورها وجود ندارد.**

برای استخراج اثر انگشت SHA-256 کلید:

```bash
keytool -list -v -keystore ./android.keystore -alias android
```

مقدار خط `SHA256:` را کپی کنید (قالب کولن‌دار مثل `AA:BB:CC:...`).

## گام ۴ — به‌روزرسانی `assetlinks.json`

فایل `output_apps/enterprise_hub/frontend/public/.well-known/assetlinks.json` را باز
کنید و مقدار `TODO_REPLACE_WITH_SHA256_FINGERPRINT_OF_RELEASE_KEYSTORE` را با اثر
انگشت واقعی جایگزین کنید:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "ir.ghazihoushmand.app",
      "sha256_cert_fingerprints": ["AA:BB:CC:...:FF"]
    }
  }
]
```

سپس سایت را دوباره منتشر کنید و صحت دسترسی به فایل را بررسی کنید:

```bash
curl -sS https://ghazihoushmand.ir/.well-known/assetlinks.json
```

- خروجی باید همان JSON و بدون خطای ۴۰۴/۴۰۳ باشد.
- دامنه باید روی HTTPS معتبر باشد و `Content-Type` آن `application/json` باشد.

### نکته دربارهٔ nginx و middleware

- `src/middleware.ts` هیچ‌کدام از مسیرهای `/.well-known/`، `/manifest.webmanifest`،
  `/sw.js` و `/offline` را در `matcher` ندارد؛ بنابراین این مسیرها دست‌نخورده به
  لایهٔ Next.js می‌رسند.
- در کانفیگ nginx دامنهٔ قاضی، تنها قاعدهٔ دقیق `location /.well-known/acme-challenge/`
  وجود دارد؛ سایر مسیرهای `/.well-known/` توسط `location /` به فرانت‌اند Next.js
  پروکسی می‌شوند. اگر در آینده قاعده‌ای برای بلاک `.well-known` اضافه شد، باید
  `/.well-known/assetlinks.json` از آن مستثنا بماند.

## گام ۵ — ساخت اپ (AAB/APK)

```bash
bubblewrap build
```

خروجی‌ها:

- `app-release-signed.apk` — برای تست روی دستگاه.
- `app-release-bundle.aab` — برای آپلود در استورها.

برای تست نصب و تأیید TWA (نوار آدرس نباید نمایش داده شود):

```bash
bubblewrap install
# یا دستی:
adb install -r ./app-release-signed.apk
```

## گام ۶ — انتشار در کافه‌بازار

1. با حساب توسعه‌دهندهٔ خود (احراز هویت با کد ملی مالک) وارد
   [پنل توسعه‌دهندگان کافه‌بازار](https://pishkhan.cafebazaar.ir) شوید.
2. «افزودن برنامه» → بارگذاری فایل `app-release-bundle.aab`.
3. نام، توضیحات، دسته‌بندی، تصاویر و آیکون فروشگاه را تکمیل کنید.
4. اطلاعات تماس/صاحب اثر باید با اطلاعات احراز هویت مالک مطابقت داشته باشد.
5. ارسال برای بازبینی و انتشار.

## گام ۷ — انتشار در مایکت

1. با حساب توسعه‌دهندهٔ خود وارد [پنل توسعه‌دهندگان مایکت](https://developer.myket.ir) شوید.
2. برنامهٔ جدید بسازید و فایل `app-release-bundle.aab` را بارگذاری کنید.
3. اطلاعات فروشگاه (نام، توضیحات، تصاویر) را تکمیل و ارسال کنید.
4. پس از تأیید، لینک نصب در صفحهٔ برنامه فعال می‌شود.

## گام ۸ — بررسی نهایی پس از انتشار

- نصب اپ از استور و باز شدن روی `/chat?source=pwa` بدون نوار مرورگر.
- بررسی برگهٔ «Lighthouse → Installable» برای سایت.
- بررسی صحت آیکون ۱۹۲/۵۱۲ و آیکون maskable در نمایشگر لانچر.

---

## آیکون‌ها

آیکون‌های فعلی به‌صورت SVG در مسیر `public/icons/` قرار دارند و در مانیفست ثبت
شده‌اند:

- `ghazi-192.svg` (۱۹۲×۱۹۲، purpose: any)
- `ghazi-512.svg` (۵۱۲×۵۱۲، purpose: any)
- `ghazi-maskable.svg` (۵۱۲×۵۱۲، purpose: maskable)

اگر Bubblewrap یا استور خواستار PNG شد، با هر ابزار گرافیکی همین طرح را به PNG با
پس‌زمینهٔ شفاف/پر رنگ در اندازه‌های ۱۹۲ و ۵۱۲ (و یک نسخهٔ maskable با حاشیهٔ امن
حدود ۲۰٪) تبدیل کرده و مسیرهای مانیفست را به فایل‌های PNG تغییر دهید.

## نگه‌داری و به‌روزرسانی

- برای هر نسخهٔ جدید اپ، `versionCode`/`versionName` را در `twa-manifest.json` بالا ببرید.
- اگر کلید امضا عوض شود، `assetlinks.json` نیز باید به‌روزرسانی شود.
- ثبت مجدد Service Worker: با هر تغییر در `public/sw.js` مقدار `CACHE_VERSION` را
  در همان فایل افزایش دهید تا کش‌های قدیمی پاک شوند.
