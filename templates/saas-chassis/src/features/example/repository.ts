import { orgRepo } from "@/lib/org-repo";
import { notes } from "./schema";

/** Example repository: always built from the session's organization id (see requireOrg()). */
export function notesRepo(organizationId: string) {
  return orgRepo(notes, organizationId);
}
