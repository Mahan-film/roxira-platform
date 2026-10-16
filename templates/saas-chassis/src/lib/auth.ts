import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { apiKey } from "@better-auth/api-key";
import { magicLink, organization } from "better-auth/plugins";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { sendMail } from "@/lib/mail";
import { trackServer } from "@/lib/track-server";

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

// BETTER_AUTH_SECRET and BETTER_AUTH_URL are read from the environment by Better Auth itself.
export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? appUrl,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    // Turn on once SMTP is configured: requireEmailVerification: true,
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await trackServer("signup", { userId: user.id });
        },
      },
    },
  },
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        await sendMail(email, "Your sign-in link", `Sign in: ${url}\n\nThe link expires soon.`);
      },
    }),
    organization({
      sendInvitationEmail: async (data) => {
        const link = `${appUrl}/accept-invitation/${data.id}`;
        await sendMail(
          data.email,
          `Invitation to join ${data.organization.name}`,
          `${data.inviter.user.name} invited you to ${data.organization.name}.\nAccept: ${link}`,
        );
      },
    }),
    // API keys belong to a user; we stamp the organization id into metadata (see settings/api-keys).
    apiKey({ enableMetadata: true }),
    nextCookies(), // must be last
  ],
});

export type Auth = typeof auth;
