import { getTranslations } from "next-intl/server";
import { AuthForm } from "@/components/auth-form";

export default async function SignInPage() {
  const t = await getTranslations("auth");
  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">{t("signInTitle")}</h1>
      <AuthForm mode="sign-in" />
    </>
  );
}
