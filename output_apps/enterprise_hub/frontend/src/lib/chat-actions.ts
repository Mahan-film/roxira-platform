// Shared, static definitions for the Smart Judge chat shell and header.
// Static UI copy only: Latin digits (0-9) everywhere, no secrets, no backend field names.

export type DraftActionKey = "defense" | "petition" | "complaint" | "notice";

export interface DraftAction {
  key: DraftActionKey;
  label: string;
  prompt: string;
}

/** Chat-based drafting actions. The prompt is sent (chip) or pre-filled (header link). */
export const DRAFT_ACTIONS: DraftAction[] = [
  {
    key: "defense",
    label: "لایحه دفاعیه",
    prompt:
      "بر اساس آخرین مکالمه و ادله پرونده، لایحه دفاعیه مستدل با استناد به مواد قانونی مرتبط، رویه قضایی و آرای وحدت رویه تنظیم کن.",
  },
  {
    key: "petition",
    label: "دادخواست حقوقی",
    prompt:
      "بر اساس شرح پرونده و مطالبات، دادخواست حقوقی کامل شامل خواسته، دلایل و منضمات و شرح دادخواست تدوین کن.",
  },
  {
    key: "complaint",
    label: "شکواییه کیفری",
    prompt:
      "با توجه به موضوع پرونده و ادله، شکواییه کیفری رسمی با ذکر عنوان اتهامی، ادله و درخواست تعقیب متهم تدوین کن.",
  },
  {
    key: "notice",
    label: "اظهارنامه رسمی",
    prompt:
      "یک اظهارنامه رسمی موضوع ماده 156 قانون آیین دادرسی مدنی با اخطار و مهلت قانونی برای موضوع پرونده تدوین کن.",
  },
];

/** Dedicated drafting pages. */
export const DRAFT_PAGES = [
  { href: "/draft-ruling", label: "پیش‌نویس رأی" },
  { href: "/draft-indictment", label: "پیش‌نویس کیفرخواست" },
] as const;

export function draftActionHref(key: DraftActionKey): string {
  return `/chat?draft=${key}`;
}

export function findDraftAction(key: string | null): DraftAction | undefined {
  return DRAFT_ACTIONS.find((a) => a.key === key);
}

export interface StarterGroup {
  title: string;
  items: { title: string; prompt: string }[];
}

export const STARTER_GROUPS: StarterGroup[] = [
  {
    title: "حقوقی و مدنی",
    items: [
      {
        title: "مطالبه خسارت تأخیر تأدیه",
        prompt:
          "طلبکار هستم و بدهکار چک را در سررسید پرداخت نکرده است. شرایط و نحوه محاسبه خسارت تأخیر تأدیه و مراحل مطالبه آن را توضیح بده.",
      },
      {
        title: "تخلیه ملک و پایان اجاره",
        prompt:
          "مدت قرارداد اجاره تمام شده و مستأجر ملک را تخلیه نمی‌کند. مراحل قانونی تخلیه و مرجع صالح برای رسیدگی چیست؟",
      },
    ],
  },
  {
    title: "کیفری",
    items: [
      {
        title: "شکایت کیفری از کلاهبرداری",
        prompt:
          "قربانی کلاهبرداری اینترنتی شده‌ام. برای طرح شکایت کیفری چه مدارکی لازم است و روند رسیدگی چگونه است؟",
      },
      {
        title: "اعاده دادرسی کیفری",
        prompt:
          "در چه شرایطی می‌توان درخواست اعاده دادرسی کیفری داد؟ موارد قانونی آن را با ذکر ماده مربوط توضیح بده.",
      },
    ],
  },
  {
    title: "صنفی و فناوری / هوش مصنوعی",
    items: [
      {
        title: "مسئولیت محتوای تولیدشده با هوش مصنوعی",
        prompt:
          "اگر یک ابزار هوش مصنوعی اطلاعات نادرست تولید کند و به کسب‌وکار من زیان بزند، مسئولیت مدنی با چه کسی است؟",
      },
      {
        title: "پرونده چنددامنه‌ای: قرارداد، دعوای صنفی و داده",
        prompt:
          "شرکت نرم‌افزاری من با یک پیمانکار قرارداد دارد؛ او داده مشتریان را بدون اجازه به شخص ثالث داده و رقیب صنفی هم از آن استفاده کرده است. جنبه‌های مدنی، کیفری، صنفی و حریم خصوصی را جداگانه تحلیل کن.",
      },
    ],
  },
  {
    title: "صلاحیت و مراجع",
    items: [
      {
        title: "صلاحیت دادگاه صلح",
        prompt: "دادگاه صلح برای چه دعاوی صلاحیت دارد؟",
      },
      {
        title: "شورای حل اختلاف یا دادگاه",
        prompt:
          "برای یک دعوای مالی با خواسته کم، باید به شورای حل اختلاف مراجعه کنم یا دادگاه؟ معیار تعیین مرجع صالح را بگو.",
      },
    ],
  },
];

export const ONBOARDING_LINE =
  "دستیار حقوقی برای تحلیل پرونده، پاسخ به پرسش‌های حقوقی و تنظیم پیش‌نویس است. پاسخ‌ها غیرالزام‌آور هستند و پیش از اقدام باید با وکیل بررسی شوند.";

export const COMPETENCE_NOTE =
  "پرسش‌های صلاحیت و مرجع، تا جای ممکن از پایگاه قوانین ما پاسخ داده می‌شود؛ در غیر این صورت با دانش عمومی و همراه با هشدار.";

export const DISCLAIMER_LINE =
  "پاسخ‌ها مشاوره حقوقی رسمی نیستند و پیش از اقدام باید توسط وکیل بازبینی شوند.";
