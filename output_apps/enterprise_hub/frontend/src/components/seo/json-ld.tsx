/**
 * کامپوننت درج اسکیمای ساختاریافته (JSON-LD) در Server Components.
 *
 * داده به‌صورت JSON امن سریالایز می‌شود (جایگزینی `<` برای جلوگیری از
 * تزریق تگ اسکریپت) و داخل تگ استاندارد `application/ld+json` قرار می‌گیرد.
 */
export function JsonLd({ data, id }: { data: Record<string, unknown>; id?: string }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");

  return (
    <script
      id={id}
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
