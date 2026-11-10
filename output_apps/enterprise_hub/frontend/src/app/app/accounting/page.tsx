import { redirect } from "next/navigation";

/**
 * Route `/app/accounting` redirects to the vouchers list route `/app/accounting/vouchers` (T68 / #230 Line 18).
 */
export default function SuiteAccountingPage() {
  redirect("/app/accounting/vouchers");
}
