import { Mail, Phone, Scale } from "lucide-react";

/**
 * فوتر رسمی سامانه قاضی هوشمند (ghazihoushmand.ir)
 * شامل نماد اعتماد الکترونیکی (eNamad)، شماره تماس پشتیبانی و قوانین سامانه.
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-white/5 bg-[#080C16] px-4 py-10 text-xs text-slate-400 sm:px-6">
      

      <div className="mx-auto mt-8 w-full max-w-5xl border-t border-white/5 pt-4 text-center text-[11px] text-slate-500">
        © 1405 — تمامی حقوق برای سامانه قاضی هوشمند محفوظ است.
      </div>
    </footer>
  );
}
