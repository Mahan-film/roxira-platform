/** Landing navigation, shared by the server page (desktop nav) and the client mobile menu. */
export const LANDING_NAV = [
  { href: '/chat', label: 'گفتگو' },
  { href: '/laws', label: 'قوانین' },
  { href: '/regulations', label: 'آرا و بخشنامه‌ها' },
  { href: '/precedents', label: 'وحدت رویه' },
  { href: '/guides', label: 'راهنماها' },
  { href: '/plans', label: 'اشتراک‌ها' },
  { href: '/about', label: 'درباره' },
] as const;

/** The chat page opens its existing login dialog when it sees this query param. */
export const LOGIN_HREF = '/chat?login=1';
