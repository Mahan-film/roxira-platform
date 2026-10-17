# OTP SMS template (Kavenegar) for one-tap code auto-read

Why: Android Chrome (WebOTP) and iOS/Safari can read the login code from the SMS
automatically, but only if the SMS text **ends with a line of the form
`@<domain> #<code>`**. The login form already supports both (see
`output_apps/enterprise_hub/frontend/src/components/auth/login-modal.tsx`). The SMS text lives
in the Kavenegar panel, not in code, so the owner has to register the template.
Backend behaviour (`_deliver_verification_code` in
`output_apps/generated_modules/smartjudge/smartjudge_module.py`) is unchanged: it sends the
verify lookup with the code as `token`.

## 1. Ghazi Houshmand (ghazihoushmand.ir)

In the Kavenegar panel, create a new verify template (for example named `ghazi-verify-v2`)
with exactly this text. `%token` is the Kavenegar placeholder for the code:

```
کد ورود قاضی هوشمند: %token
این کد را در اختیار دیگران قرار ندهید.

@ghazihoushmand.ir #%token
```

Rules for the text:

- The last line must be `@ghazihoushmand.ir #%token` with nothing after it (no trailing text,
  no link, no signature line).
- Keep one blank line before the last line.
- The domain must be the exact host the site is served from (no `https://`, no `www.`).
- Do not put any other number in the message, so a pasted SMS still yields only the 5-digit code.

## 2. Activate the new template

1. Wait until Kavenegar shows the template as approved (verify templates need approval).
2. Set the environment variable on the server that runs the Python AI core (never in code):
   `KAVENEGAR_TEMPLATE_GHAZI=ghazi-verify-v2`
   The default when unset is `ghazi-verify`.
3. Restart the AI core container (owner approval is required for production restarts), then
   request a code and confirm the message ends with `@ghazihoushmand.ir #12345`.
4. Keep the old template registered until the check passes so it can be rolled back by
   restoring the previous env value.

## 3. Roxira (roxira.ir) needs its own template

Domain-bound auto-read checks the domain in the last line against the page origin, so the
Ghazi template cannot be reused. Create a second template and point
`KAVENEGAR_TEMPLATE_ROXIRA` (default `roxira-verify`) at it:

```
کد ورود روکسیرا: %token
این کد را در اختیار دیگران قرار ندهید.

@roxira.ir #%token
```

## 4. How it behaves for users

- Android Chrome: the code appears in the field and the login is submitted automatically
  (needs the domain line above; otherwise the user just types or pastes the code).
- iOS Safari: the keyboard offers the code (`autocomplete="one-time-code"`); the form
  submits as soon as 5 digits are present.
- Pasting a whole SMS text extracts the 5-digit code.
