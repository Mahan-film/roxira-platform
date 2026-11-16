"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flexRender } from "@tanstack/react-table";
import {
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useLegacyTable,
  type LegacyColumn,
  type LegacyColumnDef,
  type LegacyRow,
  type LegacyTable,
} from "@tanstack/react-table/legacy";
import type {
  ColumnVisibilityState,
  OnChangeFn,
  RowData,
  RowSelectionState,
  SortingState,
} from "@tanstack/table-core";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  Download,
  Inbox,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";

import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatNumber } from "@/lib/fa-format";
import { cn } from "@/lib/utils";

export interface DataTableColumnMeta {
  title?: string;
  isNumeric?: boolean;
  isSummable?: boolean;
  className?: string;
  formatValue?: (val: unknown) => string;
}

export type DataTableColumnDef<TData extends RowData, TValue = unknown> = LegacyColumnDef<
  TData,
  TValue
> & {
  meta?: DataTableColumnMeta;
};

export interface DataTableProps<TData extends RowData> {
  /** Column definitions */
  columns: DataTableColumnDef<TData, unknown>[];
  /** Table data */
  data: TData[];
  /** Loading state: displays skeleton rows */
  isLoading?: boolean;
  /** Number of skeleton rows to show when loading. Defaults to 5. */
  skeletonRowCount?: number;
  /** Custom empty state to display when data is empty. Uses EmptyState if omitted. */
  emptyState?: ReactNode;
  /** Title or placeholder for global filter. Defaults to "جستجو در جدول..." */
  filterPlaceholder?: string;
  /** Whether to show global search filter. Defaults to true. */
  enableGlobalFilter?: boolean;
  /** Whether to show column visibility toggle. Defaults to true. */
  enableColumnVisibility?: boolean;
  /** Whether to show CSV export button. Defaults to true. */
  enableCsvExport?: boolean;
  /** Filename for exported CSV (without extension). Defaults to "export". */
  exportFilename?: string;
  /** Whether to enable row selection. Defaults to false. */
  enableRowSelection?: boolean;
  /** Callback when selected rows change */
  onRowSelectionChange?: (selectedRows: TData[]) => void;
  /** Whether to enable virtualization. Defaults to true when data.length > 50. */
  virtualize?: boolean;
  /** Max height for sticky scroll container (e.g. "600px", "65vh"). Defaults to "600px". */
  maxHeight?: string;
  /** Extra toolbar actions or filters */
  toolbarActions?: ReactNode;
  /** Custom class for the wrapper */
  className?: string;
}

/**
 * Exports table data to CSV with UTF-8 BOM so Microsoft Excel and
 * international tools display Persian characters without corruption.
 */
export function exportTableToCsv<TData extends RowData>(
  table: LegacyTable<TData>,
  filename = "table-export",
) {
  const visibleLeafColumns = table
    .getVisibleLeafColumns()
    .filter((col) => col.id !== "_select" && col.id !== "_actions");

  const headers = visibleLeafColumns.map((col) => {
    const meta = (col.columnDef as DataTableColumnDef<TData>).meta;
    const headerDef = col.columnDef.header;
    if (typeof headerDef === "string") return headerDef;
    if (typeof meta?.title === "string") return meta.title;
    return col.id;
  });

  const rows = table.getFilteredRowModel().rows.map((row: LegacyRow<TData>) => {
    return visibleLeafColumns.map((col) => {
      const val = row.getValue(col.id);
      if (val === null || val === undefined) return "";
      return String(val);
    });
  });

  const escapeCsvCell = (val: string) => {
    let sanitized = val;
    // Rule #9: Neutralize formula injection in Excel/Calc (=, +, -, @)
    if (/^[=@+\-]/.test(sanitized)) {
      sanitized = "'" + sanitized;
    }
    if (sanitized.includes('"') || sanitized.includes(",") || sanitized.includes("\n") || sanitized.includes("\r")) {
      return `"${sanitized.replace(/"/g, '""')}"`;
    }
    return sanitized;
  };

  const csvRows = [
    headers.map(escapeCsvCell).join(","),
    ...rows.map((row: string[]) => row.map(escapeCsvCell).join(",")),
  ];

  const csvContent = "\uFEFF" + csvRows.join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Reusable sortable column header component for DataTable
 */
export function DataTableColumnHeader<TData extends RowData, TValue = unknown>({
  column,
  title,
  className,
}: {
  column: LegacyColumn<TData, TValue>;
  title: string;
  className?: string;
}) {
  if (!column.getCanSort()) {
    return <div className={cn("text-xs font-semibold", className)}>{title}</div>;
  }

  const isSorted = column.getIsSorted();

  return (
    <button
      type="button"
      onClick={column.getToggleSortingHandler()}
      className={cn(
        "flex items-center gap-1.5 text-xs font-semibold hover:text-primary transition-colors text-start cursor-pointer select-none",
        className,
      )}
      aria-label={`مرتب‌سازی بر اساس ${title}`}
    >
      <span>{title}</span>
      {isSorted === "asc" ? (
        <ArrowUp className="size-3 text-primary" aria-hidden="true" />
      ) : isSorted === "desc" ? (
        <ArrowDown className="size-3 text-primary" aria-hidden="true" />
      ) : (
        <ArrowUpDown className="size-3 text-muted-foreground/60" aria-hidden="true" />
      )}
    </button>
  );
}

/**
 * Roxira Shared Enterprise DataTable Component
 * Built on @tanstack/react-table + @tanstack/react-virtual
 */
export function DataTable<TData extends RowData>({
  columns: userColumns,
  data,
  isLoading = false,
  skeletonRowCount = 5,
  emptyState,
  filterPlaceholder = "جستجو در جدول...",
  enableGlobalFilter = true,
  enableColumnVisibility = true,
  enableCsvExport = true,
  exportFilename = "export",
  enableRowSelection = false,
  onRowSelectionChange,
  virtualize,
  maxHeight = "600px",
  toolbarActions,
  className,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState<string>("");
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [visibilityOpen, setVisibilityOpen] = useState(false);
  const columnVisibilityRef = useRef<HTMLDivElement>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  // Close column visibility popover on outside click or escape
  useEffect(() => {
    if (!visibilityOpen) return;
    const handleDown = (e: MouseEvent) => {
      if (!columnVisibilityRef.current?.contains(e.target as Node)) {
        setVisibilityOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setVisibilityOpen(false);
    };
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [visibilityOpen]);

  // Prepend selection column if enabled
  const columns = useMemo(() => {
    if (!enableRowSelection) return userColumns;

    const selectionColumn: DataTableColumnDef<TData, unknown> = {
      id: "_select",
      header: ({ table }) => (
        <input
          type="checkbox"
          aria-label="انتخاب همه ردیف‌ها"
          className="size-4 rounded border-border accent-primary cursor-pointer"
          checked={table.getIsAllPageRowsSelected()}
          ref={(el) => {
            if (el) el.indeterminate = table.getIsSomePageRowsSelected();
          }}
          onChange={table.getToggleAllPageRowsSelectedHandler()}
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          aria-label={`انتخاب ردیف ${row.index + 1}`}
          className="size-4 rounded border-border accent-primary cursor-pointer"
          checked={row.getIsSelected()}
          disabled={!row.getCanSelect()}
          onChange={row.getToggleSelectedHandler()}
        />
      ),
      enableSorting: false,
      enableHiding: false,
      meta: {
        className: "w-10 text-center px-2",
      },
    };

    return [selectionColumn, ...userColumns];
  }, [enableRowSelection, userColumns]);

  const handleRowSelectionChange: OnChangeFn<RowSelectionState> = useCallback((updater) => {
    setRowSelection(updater);
  }, []);

  const table = useLegacyTable<TData>({
    data,
    columns,
    state: {
      sorting,
      globalFilter,
      columnVisibility,
      rowSelection,
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: handleRowSelectionChange,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  // Notify parent on row selection change
  useEffect(() => {
    if (onRowSelectionChange && enableRowSelection) {
      const selected = table.getSelectedRowModel().rows.map((r) => r.original);
      onRowSelectionChange(selected);
    }
  }, [rowSelection, onRowSelectionChange, enableRowSelection, table]);

  const rows = table.getRowModel().rows;
  const shouldVirtualize = virtualize !== undefined ? virtualize : rows.length > 50;

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 10,
    enabled: shouldVirtualize && !isLoading,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalVirtualSize = rowVirtualizer.getTotalSize();

  const paddingTop = virtualRows.length > 0 ? virtualRows[0]?.start || 0 : 0;
  const paddingBottom =
    virtualRows.length > 0 ? totalVirtualSize - (virtualRows[virtualRows.length - 1]?.end || 0) : 0;

  // Selected row stats and summable column totals
  const selectedRows = table.getSelectedRowModel().rows;
  const targetRowsForSum = selectedRows.length > 0 ? selectedRows : rows;
  const hasSummableColumn = columns.some((c) => c.meta?.isSummable);

  const columnSums = useMemo(() => {
    if (!hasSummableColumn) return {};
    const sums: Record<string, bigint> = {};
    for (const col of columns) {
      if (col.meta?.isSummable && col.id) {
        sums[col.id] = targetRowsForSum.reduce((acc, row) => {
          const raw = row.getValue(col.id as string);
          if (raw === null || raw === undefined || raw === "") return acc;
          try {
            if (typeof raw === "bigint") return acc + raw;
            if (typeof raw === "number") return acc + BigInt(Math.trunc(raw));
            if (typeof raw === "string") {
              const cleaned = raw.replace(/,/g, "").trim();
              if (cleaned && /^-?\d+$/.test(cleaned)) {
                return acc + BigInt(cleaned);
              }
            }
          } catch {
            // ignore non-convertible
          }
          return acc;
        }, 0n);
      }
    }
    return sums;
  }, [hasSummableColumn, columns, targetRowsForSum]);

  const handleExportCsv = useCallback(() => {
    exportTableToCsv(table, exportFilename);
  }, [table, exportFilename]);

  return (
    <div className={cn("space-y-3", className)}>
      {/* Table Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-1 items-center gap-2 max-w-sm">
          {enableGlobalFilter && (
            <div className="relative w-full">
              <Search
                className="absolute start-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none"
                aria-hidden="true"
              />
              <Input
                placeholder={filterPlaceholder}
                value={globalFilter ?? ""}
                onChange={(e) => setGlobalFilter(e.target.value)}
                className="ps-9 pe-8 h-9 text-xs"
              />
              {globalFilter && (
                <button
                  type="button"
                  onClick={() => setGlobalFilter("")}
                  className="absolute end-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                  aria-label="پاک کردن جستجو"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {toolbarActions}

          {enableColumnVisibility && (
            <div className="relative inline-block" ref={columnVisibilityRef}>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setVisibilityOpen((v) => !v)}
                aria-expanded={visibilityOpen}
                aria-label="تغییر ستون‌های قابل مشاهده"
                className="gap-1.5 text-xs h-9"
              >
                <SlidersHorizontal className="size-3.5" aria-hidden="true" />
                <span>ستون‌ها</span>
                <ChevronDown className="size-3 text-muted-foreground" aria-hidden="true" />
              </Button>

              {visibilityOpen && (
                <div
                  role="menu"
                  className="absolute end-0 z-30 mt-1 flex min-w-44 flex-col rounded-lg border border-border bg-popover p-2 text-sm text-popover-foreground shadow-lg"
                >
                  <div className="px-2 py-1 text-xs font-semibold text-muted-foreground border-b mb-1">
                    نمایش ستون‌ها
                  </div>
                  <div className="max-h-60 overflow-y-auto space-y-1">
                    {table
                      .getAllLeafColumns()
                      .filter((col) => col.getCanHide() && col.id !== "_select")
                      .map((col) => {
                        const meta = (col.columnDef as DataTableColumnDef<TData>).meta;
                        const title =
                          typeof col.columnDef.header === "string"
                            ? col.columnDef.header
                            : meta?.title || col.id;
                        return (
                          <label
                            key={col.id}
                            className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted cursor-pointer text-xs"
                          >
                            <input
                              type="checkbox"
                              checked={col.getIsVisible()}
                              onChange={col.getToggleVisibilityHandler()}
                              className="size-3.5 rounded border-border accent-primary cursor-pointer"
                            />
                            <span className="truncate">{title}</span>
                          </label>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
          )}

          {enableCsvExport && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCsv}
              disabled={isLoading || rows.length === 0}
              className="gap-1.5 text-xs h-9"
              aria-label="خروجی اکسل و CSV"
            >
              <Download className="size-3.5" aria-hidden="true" />
              <span>خروجی CSV</span>
            </Button>
          )}
        </div>
      </div>

      {/* Sticky Table Scroll Container */}
      <div
        ref={parentRef}
        data-slot="data-table-scroll-container"
        className="relative w-full overflow-auto rounded-lg border border-border bg-card"
        style={{ maxHeight }}
      >
        <Table>
          <TableHeader className="sticky top-0 z-20 bg-muted/80 backdrop-blur-md shadow-xs">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="border-b">
                {headerGroup.headers.map((header) => {
                  const meta = (header.column.columnDef as DataTableColumnDef<TData>).meta;
                  return (
                    <TableHead
                      key={header.id}
                      className={cn(
                        "h-10 px-3 text-xs font-semibold whitespace-nowrap",
                        meta?.isNumeric && "text-end tabular-nums",
                        meta?.className,
                      )}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>

          <TableBody>
            {isLoading ? (
              Array.from({ length: skeletonRowCount }).map((_, rIdx) => (
                <TableRow key={`skeleton-row-${rIdx}`} className="h-11">
                  {columns.map((_, cIdx) => (
                    <TableCell key={`skeleton-cell-${rIdx}-${cIdx}`} className="p-3">
                      <Skeleton className="h-5 w-full rounded" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={table.getVisibleLeafColumns().length}
                  className="p-8 text-center"
                >
                  {emptyState ?? (
                    <EmptyState
                      icon={<Inbox className="size-6 text-muted-foreground" aria-hidden="true" />}
                      description={
                        globalFilter
                          ? "هیچ موردی با این عبارت جستجو یافت نشد."
                          : "داده‌ای برای نمایش وجود ندارد."
                      }
                      className="border-none bg-transparent shadow-none"
                    />
                  )}
                </TableCell>
              </TableRow>
            ) : shouldVirtualize ? (
              <>
                {paddingTop > 0 && (
                  <tr>
                    <td
                      style={{ height: `${paddingTop}px` }}
                      colSpan={table.getVisibleLeafColumns().length}
                    />
                  </tr>
                )}
                {virtualRows.map((virtualRow) => {
                  const row = rows[virtualRow.index];
                  return (
                    <TableRow
                      key={row.id}
                      data-state={row.getIsSelected() && "selected"}
                      ref={rowVirtualizer.measureElement}
                      data-index={virtualRow.index}
                      className="transition-colors hover:bg-muted/40"
                    >
                      {row.getVisibleCells().map((cell) => {
                        const meta = (cell.column.columnDef as DataTableColumnDef<TData>).meta;
                        return (
                          <TableCell
                            key={cell.id}
                            className={cn(
                              "p-3 text-xs align-middle",
                              meta?.isNumeric && "text-end tabular-nums font-mono",
                              meta?.className,
                            )}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })}
                {paddingBottom > 0 && (
                  <tr>
                    <td
                      style={{ height: `${paddingBottom}px` }}
                      colSpan={table.getVisibleLeafColumns().length}
                    />
                  </tr>
                )}
              </>
            ) : (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  className="transition-colors hover:bg-muted/40"
                >
                  {row.getVisibleCells().map((cell) => {
                    const meta = (cell.column.columnDef as DataTableColumnDef<TData>).meta;
                    return (
                      <TableCell
                        key={cell.id}
                        className={cn(
                          "p-3 text-xs align-middle",
                          meta?.isNumeric && "text-end tabular-nums font-mono",
                          meta?.className,
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            )}
          </TableBody>

          {/* Sum / Selection Footer */}
          {(hasSummableColumn || enableRowSelection) && !isLoading && rows.length > 0 && (
            <TableFooter className="sticky bottom-0 z-10 bg-muted/90 font-medium backdrop-blur-md">
              <TableRow>
                {table.getVisibleLeafColumns().map((col, idx) => {
                  const meta = (col.columnDef as DataTableColumnDef<TData>).meta;
                  const isFirst = idx === 0 || (enableRowSelection && idx === 1);

                  if (enableRowSelection && idx === 0) {
                    return (
                      <TableCell key={col.id} className="p-3 text-center text-xs">
                        {selectedRows.length > 0 ? `${formatNumber(selectedRows.length)}` : ""}
                      </TableCell>
                    );
                  }

                  if (meta?.isSummable && col.id) {
                    const sum = columnSums[col.id] ?? 0n;
                    const formatted = meta.formatValue ? meta.formatValue(sum) : formatNumber(Number(sum));
                    return (
                      <TableCell
                        key={col.id}
                        className={cn(
                          "p-3 text-xs font-semibold tabular-nums font-mono",
                          meta.isNumeric && "text-end",
                          meta.className,
                        )}
                      >
                        {formatted}
                      </TableCell>
                    );
                  }

                  if (isFirst) {
                    return (
                      <TableCell key={col.id} className="p-3 text-xs font-semibold">
                        {selectedRows.length > 0
                          ? `مجموع (${formatNumber(selectedRows.length)} ردیف انتخاب‌شده)`
                          : `مجموع (${formatNumber(rows.length)} ردیف)`}
                      </TableCell>
                    );
                  }

                  return (
                    <TableCell key={col.id} className="p-3 text-xs text-muted-foreground">
                      —
                    </TableCell>
                  );
                })}
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>

      {/* Row Count / Selection Status Summary */}
      <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
        <div>
          {enableRowSelection && selectedRows.length > 0 ? (
            <span>
              {formatNumber(selectedRows.length)} از {formatNumber(rows.length)} ردیف انتخاب شده
              است.
            </span>
          ) : (
            <span>مجموع {formatNumber(rows.length)} ردیف</span>
          )}
        </div>
      </div>
    </div>
  );
}
