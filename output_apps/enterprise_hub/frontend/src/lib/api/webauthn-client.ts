/**
 * کلاینت احراز هویت Passkey / WebAuthn.
 *
 * منطبق بر قرارداد Swagger کنترلر NestJS `auth`:
 *   • POST /api/backend/auth/webauthn/registration/options
 *   • POST /api/backend/auth/webauthn/registration/verify
 *   • POST /api/backend/auth/webauthn/authentication/options
 *   • POST /api/backend/auth/webauthn/authentication/verify
 *
 * مراسم WebAuthn با API بومی مرورگر (`navigator.credentials`) انجام و
 * پاسخ‌ها به Base64URL تبدیل و به سرور ارسال می‌شوند.
 */

import { AuthSession } from "@/lib/api/auth-client";
import { API_PROXY_BASE_PATH, AUTH_RESOURCE_PATH } from "@/lib/api/config";
import { apiRequest } from "@/lib/api/http-client";

const AUTH_ENDPOINT = `${API_PROXY_BASE_PATH}/${AUTH_RESOURCE_PATH}/webauthn`;

interface ServerCredentialParameter {
  type: string;
  alg: number;
}

interface ServerCredentialDescriptor {
  type: string;
  id: string;
  transports?: string[];
}

interface ServerRegistrationOptions {
  challenge: string;
  rp: { name: string; id: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: ServerCredentialParameter[];
  timeout: number;
  attestation: string;
  authenticatorSelection: {
    authenticatorAttachment?: string;
    residentKey: string;
    requireResidentKey: boolean;
    userVerification: string;
  };
  excludeCredentials: ServerCredentialDescriptor[];
  extensions?: Record<string, unknown>;
}

interface ServerAuthenticationOptions {
  challenge: string;
  rpId: string;
  timeout: number;
  userVerification: string;
  allowCredentials: ServerCredentialDescriptor[];
  allowDiscoverable: boolean;
}

export interface RegistrationVerifyResponse {
  verified: boolean;
  credentialId: string;
  algorithm: number;
  registeredAt: string;
}

/** پشتیبانی مرورگر از WebAuthn. */
export function isWebAuthnSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined" &&
    typeof navigator?.credentials !== "undefined"
  );
}

/** پشتیبانی از Authenticator داخلی (بیومتریک پلتفرم). */
export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isWebAuthnSupported()) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** کدگذاری ArrayBuffer به Base64URL. */
function bufferToBase64Url(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** رمزگشایی Base64URL به ArrayBuffer. */
function base64UrlToBuffer(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding =
    normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const binary = atob(normalized + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function toCreationOptions(
  options: ServerRegistrationOptions,
): PublicKeyCredentialCreationOptions {
  return {
    challenge: base64UrlToBuffer(options.challenge),
    rp: options.rp,
    user: {
      id: base64UrlToBuffer(options.user.id),
      name: options.user.name,
      displayName: options.user.displayName,
    },
    pubKeyCredParams: options.pubKeyCredParams as PublicKeyCredentialParameters[],
    timeout: options.timeout,
    attestation: options.attestation as AttestationConveyancePreference,
    authenticatorSelection: {
      authenticatorAttachment: options.authenticatorSelection
        .authenticatorAttachment as AuthenticatorAttachment | undefined,
      residentKey: options.authenticatorSelection
        .residentKey as ResidentKeyRequirement,
      requireResidentKey: options.authenticatorSelection.requireResidentKey,
      userVerification: options.authenticatorSelection
        .userVerification as UserVerificationRequirement,
    },
    excludeCredentials: options.excludeCredentials.map((credential) => ({
      type: "public-key" as PublicKeyCredentialType,
      id: base64UrlToBuffer(credential.id),
      transports: credential.transports as AuthenticatorTransport[] | undefined,
    })),
    extensions: options.extensions,
  };
}

function toRequestOptions(
  options: ServerAuthenticationOptions,
): PublicKeyCredentialRequestOptions {
  return {
    challenge: base64UrlToBuffer(options.challenge),
    rpId: options.rpId,
    timeout: options.timeout,
    userVerification: options.userVerification as UserVerificationRequirement,
    allowCredentials: options.allowCredentials.map((credential) => ({
      type: "public-key" as PublicKeyCredentialType,
      id: base64UrlToBuffer(credential.id),
      transports: credential.transports as AuthenticatorTransport[] | undefined,
    })),
  };
}

/** ثبت Passkey جدید برای شماره همراه (بیومتریک یا سخت‌افزاری). */
export async function registerPasskey(
  phone: string,
  label?: string,
): Promise<RegistrationVerifyResponse> {
  if (!isWebAuthnSupported()) {
    throw new Error("مرورگر شما از Passkey پشتیبانی نمی‌کند.");
  }

  const options = await apiRequest<ServerRegistrationOptions>(
    `${AUTH_ENDPOINT}/registration/options`,
    { method: "POST", body: { phone } },
  );

  const credential = (await navigator.credentials.create({
    publicKey: toCreationOptions(options),
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error("ثبت Passkey لغو شد.");
  }

  const response = credential.response as AuthenticatorAttestationResponse;
  const transports =
    typeof response.getTransports === "function"
      ? response.getTransports()
      : undefined;

  return apiRequest<RegistrationVerifyResponse>(
    `${AUTH_ENDPOINT}/registration/verify`,
    {
      method: "POST",
      body: {
        phone,
        id: credential.id,
        rawId: bufferToBase64Url(credential.rawId),
        type: credential.type,
        response: {
          clientDataJSON: bufferToBase64Url(response.clientDataJSON),
          attestationObject: bufferToBase64Url(response.attestationObject),
        },
        transports,
        deviceType: credential.authenticatorAttachment ?? undefined,
        backedUp: false,
        label,
      },
    },
  );
}

/**
 * ورود امن با Passkey و دریافت سشن JWT.
 * ارسال شماره همراه اختیاری است؛ در صورت نبود آن، Passkey همگام‌شده
 * (Discoverable) به‌کار می‌رود.
 */
export async function loginWithPasskey(
  phone?: string,
): Promise<AuthSession> {
  if (!isWebAuthnSupported()) {
    throw new Error("مرورگر شما از Passkey پشتیبانی نمی‌کند.");
  }

  const options = await apiRequest<ServerAuthenticationOptions>(
    `${AUTH_ENDPOINT}/authentication/options`,
    { method: "POST", body: phone ? { phone } : {} },
  );

  const credential = (await navigator.credentials.get({
    publicKey: toRequestOptions(options),
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error("ورود با Passkey لغو شد.");
  }

  const response = credential.response as AuthenticatorAssertionResponse;

  return apiRequest<AuthSession>(`${AUTH_ENDPOINT}/authentication/verify`, {
    method: "POST",
    body: {
      phone: phone || undefined,
      id: credential.id,
      rawId: bufferToBase64Url(credential.rawId),
      type: credential.type,
      response: {
        clientDataJSON: bufferToBase64Url(response.clientDataJSON),
        authenticatorData: bufferToBase64Url(response.authenticatorData),
        signature: bufferToBase64Url(response.signature),
        userHandle: response.userHandle
          ? bufferToBase64Url(response.userHandle)
          : undefined,
      },
      deviceType: credential.authenticatorAttachment ?? undefined,
    },
  });
}
