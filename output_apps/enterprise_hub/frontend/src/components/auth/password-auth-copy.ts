import type { UiLocale } from "@/lib/api/auth-client";

/** Every string of the password sign-in panel, per language. */
export interface PasswordAuthCopy {
  identifier: string;
  identifierPlaceholder: string;
  email: string;
  username: string;
  usernameHint: string;
  password: string;
  passwordHint: string;
  organization: string;
  organizationHint: string;
  login: string;
  signup: string;
  forgotSubmit: string;
  toSignup: string;
  toLogin: string;
  toForgot: string;
  forgotNotice: string;
  errInvalidLogin: string;
  errRateLimit: string;
  errUnavailable: string;
  errNetwork: string;
  errEmail: string;
  errPasswordShort: string;
  errIdentifier: string;
  errUsername: string;
  errServer: string;
  mfaTitle: string;
  mfaHint: string;
  mfaCode: string;
  mfaSubmit: string;
  errMfa: string;
  inviteNote: string;
}

const fa: PasswordAuthCopy = {
  identifier: "ایمیل یا نام کاربری",
  identifierPlaceholder: "name@example.com",
  email: "ایمیل",
  username: "نام کاربری (اختیاری)",
  usernameHint: "۳ تا ۳۲ نویسه: حروف انگلیسی کوچک، رقم، نقطه، خط تیره و زیرخط.",
  password: "رمز عبور",
  passwordHint: "حداقل ۱۰ نویسه؛ رمزهای رایج پذیرفته نمی‌شود.",
  organization: "نام سازمان (اختیاری)",
  organizationHint: "اگر خالی بگذارید حساب بدون سازمان ساخته می‌شود و بعداً می‌توانید سازمان بسازید یا با دعوت‌نامه عضو شوید.",
  login: "ورود",
  signup: "ساخت حساب",
  forgotSubmit: "ارسال پیوند بازیابی",
  toSignup: "حساب ندارید؟ ثبت‌نام",
  toLogin: "بازگشت به ورود",
  toForgot: "فراموشی رمز عبور",
  forgotNotice:
    "اگر حسابی با این مشخصات و ایمیل بازیابی وجود داشته باشد، پیوند تغییر رمز ارسال شد. پوشهٔ اسپم را هم ببینید.",
  errInvalidLogin: "ایمیل/نام کاربری یا رمز عبور درست نیست.",
  errRateLimit: "تلاش‌های ناموفق زیاد بود. چند دقیقه بعد دوباره امتحان کنید.",
  errUnavailable: "ساخت حساب با این مشخصات ممکن نشد. نام کاربری یا ایمیل دیگری امتحان کنید یا وارد شوید.",
  errNetwork: "اتصال به سرور برقرار نشد. اینترنت خود را بررسی کنید و دوباره تلاش کنید.",
  errEmail: "نشانی ایمیل نامعتبر است.",
  errPasswordShort: "رمز عبور باید حداقل ۱۰ نویسه باشد.",
  errIdentifier: "ایمیل یا نام کاربری را وارد کنید.",
  errUsername: "نام کاربری نامعتبر است (۳ تا ۳۲ نویسه: حروف کوچک انگلیسی، رقم، . _ -).",
  errServer: "خطای سرور؛ دوباره تلاش کنید.",
  mfaTitle: "تأیید دومرحله‌ای",
  mfaHint: "کد ۶ رقمی برنامهٔ احراز هویت (یا یکی از کدهای بازیابی) را وارد کنید.",
  mfaCode: "کد تأیید",
  mfaSubmit: "تأیید و ورود",
  errMfa: "کد درست نیست یا منقضی شده است.",
  inviteNote: "با دعوت‌نامه عضو سازمان می‌شوید؛ نیازی به نام سازمان نیست.",
};

const en: PasswordAuthCopy = {
  identifier: "Email or username",
  identifierPlaceholder: "name@example.com",
  email: "Email",
  username: "Username (optional)",
  usernameHint: "3-32 characters: lowercase letters, digits, dot, dash and underscore.",
  password: "Password",
  passwordHint: "At least 10 characters; common passwords are rejected.",
  organization: "Organization name (optional)",
  organizationHint: "Leave empty to create your account alone; you can create an organization later or join one by invitation.",
  login: "Sign in",
  signup: "Create account",
  forgotSubmit: "Send reset link",
  toSignup: "No account? Sign up",
  toLogin: "Back to sign in",
  toForgot: "Forgot password?",
  forgotNotice:
    "If an account with a recovery email exists, a reset link has been sent. Check your spam folder too.",
  errInvalidLogin: "Invalid username/email or password.",
  errRateLimit: "Too many attempts. Try again in a few minutes.",
  errUnavailable: "Could not create the account with these details. Try a different username or email, or sign in.",
  errNetwork: "Could not reach the server. Check your connection and try again.",
  errEmail: "Enter a valid email address.",
  errPasswordShort: "Password must be at least 10 characters.",
  errIdentifier: "Enter your email or username.",
  errUsername: "Invalid username (3-32 characters: lowercase letters, digits, . _ -).",
  errServer: "Server error. Please try again.",
  mfaTitle: "Two-step verification",
  mfaHint: "Enter the 6-digit code from your authenticator app (or one of your recovery codes).",
  mfaCode: "Verification code",
  mfaSubmit: "Verify and sign in",
  errMfa: "That code is not correct or has expired.",
  inviteNote: "You are joining an organization by invitation; no organization name is needed.",
};

export const PASSWORD_AUTH_COPY: Record<UiLocale, PasswordAuthCopy> = { fa, en };
