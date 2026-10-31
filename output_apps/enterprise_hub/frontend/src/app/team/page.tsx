import { redirect } from "next/navigation";

/** The old owner-only member list moved to the roles-aware members screen. */
export default function TeamRedirectPage(): never {
  redirect("/app/settings/members");
}
