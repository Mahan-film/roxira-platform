/**
 * ثابت‌های ماژول پایش سلامت سیستم (System Health Monitoring).
 */

/** توکن تزریق کلاینت Docker Engine. */
export const DOCKER_ENGINE_CLIENT = 'DOCKER_ENGINE_CLIENT';

/** مسیر پیش‌فرض سوکت Docker روی میزبان (داخل کانتینر mount می‌شود). */
export const DOCKER_SOCKET_PATH_DEFAULT = '/var/run/docker.sock';

/** نسخه API مورد استفاده Docker Engine (سازگار با موتورهای ۱.۴۱+). */
export const DOCKER_API_VERSION = 'v1.41';

/** مسیر فایل اطلاعات حافظه میزبان در لینوکس. */
export const MEMINFO_PATH = '/proc/meminfo';

/** مهلت مجاز هر درخواست Docker API (میلی‌ثانیه)؛ stats ممکن است چند ثانیه طول بکشد. */
export const DOCKER_REQUEST_TIMEOUT_MS = 10000;
