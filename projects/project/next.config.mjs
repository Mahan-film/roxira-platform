/** @type {import("next").NextConfig} */
const nextConfig = {
  // خروجی کاملاً ایستا (بدون سرور Node) برای انتشار روی GitHub Pages.
  output: "export",
  // بهینه‌سازی تصویر در حالت export پشتیبانی نمی‌شود.
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
