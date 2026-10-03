# Roxira Project (static RTL)

اسکلت پروژهٔ ایستای Next.js (App Router) با خروجی `output: "export"`،
Tailwind CSS، راه‌اندازی پایهٔ shadcn/ui، فونت self-host وزیرمتن و پشتیبانی
راست‌به‌چپ (`html lang="fa" dir="rtl"`) و حالت روشن/تیره بر پایهٔ کلاس.

## دستورها

```sh
npm install
npm run dev          # سرور توسعه
npm run build        # ساخت خروجی ایستا در out/
npm run lint         # eslint
npm run check:export # بررسی وجود out/index.html و ویژگی‌های rtl/fa
```

`npm run check:export` پس از `npm run build` اجرا می‌شود (خروجی ایستا را
اعتبارسنجی می‌کند). پروژه هیچ محتوایی ندارد؛ صفحهٔ خانه یک جانگهدار است.
