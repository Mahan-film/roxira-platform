import { getRequestConfig } from 'next-intl/server';
import { DEFAULT_LOCALE, getMessages } from '@/lib/i18n/messages';

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;
  if (!locale || locale !== 'en') {
    locale = DEFAULT_LOCALE;
  }
  return {
    locale,
    messages: getMessages(locale),
  };
});
