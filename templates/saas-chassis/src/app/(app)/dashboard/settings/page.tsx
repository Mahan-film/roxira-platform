import { ProfileForm } from "@/components/profile-form";
import { requireOrg } from "@/lib/tenant";

export default async function ProfileSettingsPage() {
  const org = await requireOrg();
  return <ProfileForm name={org.userName} email={org.userEmail} />;
}
