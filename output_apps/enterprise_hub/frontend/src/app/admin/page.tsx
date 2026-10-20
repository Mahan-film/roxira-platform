import { notFound } from "next/navigation";

/** /admin is always 404 on public hosts (deploy smoke test + security policy).
 * The owner console lives at /owner behind the server-side admin gate. */
export default function AdminPage() {
  notFound();
}
