/**
 * auth.types.ts – TypeScript interfaces for the auth flow
 * Dependencies: none
 */

export interface AuthUser {
  id: string;
  email: string;
  totpEnabled: boolean;
  // How this session authenticated — carried into the access token's `amr`
  // claim. Defaults to 'otp' when omitted (every mint site except
  // /auth/client-cert-login and a cert-verified /auth/refresh).
  authMethod?: 'otp' | 'cert';
  // Set for a session obtained through an ORGANIZATION login certificate: the
  // only instance the session may see (access token claims kind:'org', inst).
  scopeInstanceId?: string;
}

export interface JwtPayload {
  sub: string; // user.id
  email: string;
  amr?: 'otp' | 'cert'; // authentication method reference
  kind?: 'org'; // org-scoped session (organization login certificate)
  inst?: string; // the one instance an org-scoped session may access
  iat: number;
  exp: number;
}

// Temporary token after OTP verification (before TOTP)
export interface TempTokenPayload {
  sub: string;
  email: string;
  purpose: 'totp_required' | 'totp_setup';
  iat: number;
  exp: number;
}

export interface OtpRequestBody {
  email: string;
}

export interface OtpVerifyBody {
  email: string;
  code: string;
}

export interface TotpVerifyBody {
  tempToken: string;
  code: string;
}

export interface TotpConfirmBody {
  tempToken: string;
  code: string;
}
