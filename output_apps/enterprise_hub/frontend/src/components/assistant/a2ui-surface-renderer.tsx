"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type A2UIComponentType = "table" | "kpi_tile" | "chart" | "confirm_form";

export interface A2UIBoundNode {
  id: string;
  type: A2UIComponentType;
  title?: string;
  data: unknown;
  props?: Record<string, unknown>;
}

export interface A2UISurfaceRendererProps {
  enabled: boolean;
  surface: "home_hub" | string;
  components: A2UIBoundNode[];
  onConfirm?: (nodeId: string, payload: unknown) => void;
}

/**
 * T167: Home-hub-only A2UI renderer mapped strictly to our existing UI
 * components. Unknown component types are never rendered.
 */
export function A2UISurfaceRenderer({
  enabled,
  surface,
  components,
  onConfirm,
}: A2UISurfaceRendererProps) {
  if (!enabled || surface !== "home_hub" || components.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-3">
      {components.map((node) => {
        if (node.type === "kpi_tile") {
          return (
            <Card key={node.id} className="border border-border bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs text-muted-foreground">
                  {node.title ?? "شاخص"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{String(node.data ?? "—")}</div>
              </CardContent>
            </Card>
          );
        }

        if (node.type === "table") {
          const rows = Array.isArray(node.data)
            ? (node.data as Array<Record<string, unknown>>)
            : [];
          const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
          return (
            <Card key={node.id} className="border border-border bg-card">
              {node.title && (
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">{node.title}</CardTitle>
                </CardHeader>
              )}
              <CardContent className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-right">
                      {columns.map((col) => (
                        <th key={col} className="py-1.5 px-2 font-medium text-muted-foreground">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, idx) => (
                      <tr key={idx} className="border-b border-border/50">
                        {columns.map((col) => (
                          <td key={col} className="py-1.5 px-2">
                            {String(row[col] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          );
        }

        if (node.type === "chart") {
          const points = Array.isArray(node.data)
            ? (node.data as Array<Record<string, unknown>>)
            : [];
          return (
            <Card key={node.id} className="border border-border bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{node.title ?? "نمودار"}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {points.map((pt, idx) => (
                  <Badge key={idx} variant="outline" className="text-xs">
                    {Object.values(pt).map(String).join(": ")}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          );
        }

        if (node.type === "confirm_form") {
          return (
            <Card key={node.id} className="border border-border bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{node.title ?? "تأیید عملیات"}</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {typeof node.data === "object" && node.data !== null
                    ? JSON.stringify(node.data)
                    : String(node.data ?? "")}
                </span>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => onConfirm?.(node.id, node.data)}
                >
                  تأیید
                </Button>
              </CardContent>
            </Card>
          );
        }

        return null;
      })}
    </div>
  );
}
