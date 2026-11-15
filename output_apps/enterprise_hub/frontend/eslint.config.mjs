import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const PALETTE_REGEX =
  /^(?:[a-zA-Z0-9_-]+:)*(?:bg|text|border)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+$/;
const DIRECTION_REGEX =
  /^(?:[a-zA-Z0-9_-]+:)*(?:-?(?:ml|mr|pl|pr|left|right)-[a-zA-Z0-9_./\[\]-]+|text-(?:left|right)|border-[lr](?:-[a-zA-Z0-9_./\[\]-]+)?|rounded-[lr](?:-[a-zA-Z0-9_./\[\]-]+)?)$/;

const localUiDebtPlugin = {
  rules: {
    "no-raw-palette-or-physical-direction": {
      meta: {
        type: "suggestion",
        docs: {
          description:
            "Disallow raw palette and physical-direction Tailwind classes outside components/ui",
        },
        messages: {
          rawPalette:
            "Raw palette class '{{cls}}' detected. Use semantic tokens (primary, muted, success, warning, info, destructive, card, border).",
          physicalDirection:
            "Physical direction class '{{cls}}' detected. Use logical classes (ms-, me-, ps-, pe-, start-, end-, text-start, text-end, border-s, border-e, rounded-s, rounded-e).",
        },
      },
      create(context) {
        function checkString(node, str) {
          if (!str || typeof str !== "string") return;
          const tokens = str.split(/\s+/);
          for (const tok of tokens) {
            const clean = tok.replace(/^[,\s;()[\]{}]+|[,\s;()[\]{}]+$/g, "");
            if (PALETTE_REGEX.test(clean)) {
              context.report({
                node,
                messageId: "rawPalette",
                data: { cls: clean },
              });
            } else if (DIRECTION_REGEX.test(clean)) {
              context.report({
                node,
                messageId: "physicalDirection",
                data: { cls: clean },
              });
            }
          }
        }

        function checkNode(node) {
          if (!node) return;
          if (node.type === "Literal" && typeof node.value === "string") {
            checkString(node, node.value);
          } else if (node.type === "TemplateLiteral") {
            for (const elem of node.quasis) {
              checkString(elem, elem.value.cooked || elem.value.raw);
            }
            for (const expr of node.expressions) {
              checkNode(expr);
            }
          } else if (node.type === "JSXExpressionContainer") {
            checkNode(node.expression);
          } else if (node.type === "ConditionalExpression") {
            checkNode(node.consequent);
            checkNode(node.alternate);
          } else if (node.type === "LogicalExpression") {
            checkNode(node.right);
          }
        }

        return {
          JSXAttribute(node) {
            const attrName = node.name && node.name.name;
            if (attrName === "className" || attrName === "class") {
              checkNode(node.value);
            }
          },
          CallExpression(node) {
            const callee = node.callee;
            const name = callee.name || (callee.property && callee.property.name);
            if (name === "cn" || name === "clsx" || name === "cva") {
              for (const arg of node.arguments) {
                checkNode(arg);
              }
            }
          },
          Property(node) {
            const key = node.key;
            const keyName = key.name || key.value;
            if (keyName === "className" || keyName === "class") {
              checkNode(node.value);
            }
          },
        };
      },
    },
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    files: ["src/**/*.{ts,tsx,js,jsx}"],
    ignores: ["src/components/ui/**", "**/components/ui/**"],
    plugins: {
      "ui-debt": localUiDebtPlugin,
    },
    rules: {
      "ui-debt/no-raw-palette-or-physical-direction": "warn",
    },
  },
]);

export default eslintConfig;
