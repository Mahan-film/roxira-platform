/* eslint-disable @typescript-eslint/no-var-requires */

/**
 * بارگذار MCP SDK و zod.
 *
 * پکیج رسمی `@modelcontextprotocol/sdk` بیلد دوگانه ESM/CJS را پشت یک نگاشت
 * `exports` منتشر می‌کند؛ در حالی که `tsconfig` این لایه NestJS از رزولوشن
 * کلاسیک (`moduleResolution: "node"`) استفاده می‌کند که نگاشت `exports` را
 * نمی‌خواند. بنابراین بارگذاری در زمان اجرا از مسیر `require()` انجام می‌شود
 * (که Node آن را بر اساس `exports` حل می‌کند) تا هم typecheck و هم اجرا سالم بماند.
 *
 * `zod` به‌عنوان وابستگی غیراختیاری همین SDK نصب می‌شود و برای تعریف
 * اسکیمای ورودی ابزارهای MCP استفاده می‌گردد.
 */
const mcpServerModule: any = require('@modelcontextprotocol/sdk/server/mcp.js');
const streamableHttpModule: any = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const zodModule: any = require('zod');

/** نمونه ساز سرور MCP (ابزارها روی آن ثبت می‌شوند). */
export const McpServer: any = mcpServerModule.McpServer;

/** انتقال‌دهنده Streamable HTTP (بدون حالت session، stateless). */
export const StreamableHTTPServerTransport: any =
  streamableHttpModule.StreamableHTTPServerTransport;

/** فضای‌نام zod برای تعریف اسکیمای ورودی ابزارها. */
export const z: any = zodModule.z ?? zodModule;

/** نتیجه استاندارد فراخوانی یک ابزار MCP. */
export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}
