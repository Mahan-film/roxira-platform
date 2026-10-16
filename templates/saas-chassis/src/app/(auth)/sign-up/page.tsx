import { getTranslations } from "next-intl/server";
import { AuthForm } from "@/components/auth-form";

export default async function SignUpPage() {
  const t = await getTranslations("auth");
  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">{t("signUpTitle")}</h1>
      <AuthForm mode="sign-up" />
    </>
  );
}
