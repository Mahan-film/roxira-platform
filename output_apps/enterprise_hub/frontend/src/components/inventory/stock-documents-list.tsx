"use client";

import { Fragment, useEffect, useState } from "react";

import { loadErrorMessage } from "@/components/app/app-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getStockDocument, listStockDocuments } from "@/lib/api/inventory-client";
import { formatMoneyRial, formatNumber } from "@/lib/fa-format";
import {
  STOCK_DOCUMENT_TYPE_LABELS,
  type StockDocument,
  type StockDocumentType,
  type Warehouse,
} from "@/types/inventory";

const PAGE_SIZE = 10;

interface StockDocumentsListProps {
  warehouses: Warehouse[];
  refreshKey: number;
}

/** Register of stock documents; a row opens its lines. */
export function StockDocumentsList({ warehouses, refreshKey }: StockDocumentsListProps) {
  const [docs, setDocs] = useState<StockDocument[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [type, setType] = useState<StockDocumentType | "">("");
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<StockDocument | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    listStockDocuments({ page, limit: PAGE_SIZE, docType: type || undefined }, controller.signal)
      .then((result) => {
        setDocs(result.data);
        setTotal(result.total);
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(loadErrorMessage(err));
      });
    return () => controller.abort();
  }, [page, type, refreshKey]);

  useEffect(() => {
    if (openId === null) return;
    const controller = new AbortController();
    getStockDocument(openId, controller.signal)
      .then(setDetail)
      .catch(() => setDetail(null));
    return () => controller.abort();
  }, [openId]);

  const name = (id: number | null) => (id === null ? "—" : warehouses.find((w) => w.id === id)?.name ?? `#${id}`);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">اسناد انبار</h2>
        <select
          aria-label="نوع سند"
          className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
          value={type}
          onChange={(e) => {
            setType(e.target.value as StockDocumentType | "");
            setPage(1);
          }}
        >
          <option value="">همهٔ اسناد</option>
          {(Object.keys(STOCK_DOCUMENT_TYPE_LABELS) as StockDocumentType[]).map((t) => (
            <option key={t} value={t}>{STOCK_DOCUMENT_TYPE_LABELS[t]}</option>
          ))}
        </select>
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      <Table className="mt-2">
        <TableHeader>
          <TableRow>
            <TableHead>شماره</TableHead>
            <TableHead>نوع</TableHead>
            <TableHead>تاریخ</TableHead>
            <TableHead>از انبار</TableHead>
            <TableHead>به انبار</TableHead>
            <TableHead>مرجع</TableHead>
            <TableHead>ارزش</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {docs.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">سندی ثبت نشده است.</TableCell>
            </TableRow>
          ) : (
            docs.map((doc) => (
              <Fragment key={doc.id}>
                <TableRow className="cursor-pointer" onClick={() => setOpenId((cur) => (cur === doc.id ? null : doc.id))}>
                  <TableCell className="font-mono text-xs">{doc.docNumber}</TableCell>
                  <TableCell><Badge variant="outline">{STOCK_DOCUMENT_TYPE_LABELS[doc.docType]}</Badge></TableCell>
                  <TableCell className="whitespace-nowrap">{doc.docDate}</TableCell>
                  <TableCell>{name(doc.fromWarehouseId)}</TableCell>
                  <TableCell>{name(doc.toWarehouseId)}</TableCell>
                  <TableCell>{doc.reference ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatMoneyRial(doc.totalValue)}</TableCell>
                </TableRow>
                {openId === doc.id && detail?.id === doc.id && (
                  <TableRow>
                    <TableCell colSpan={7} className="bg-muted/30">
                      <ul className="grid gap-1 text-xs">
                        {detail.lines?.map((line) => (
                          <li key={line.id} className="flex flex-wrap gap-x-4">
                            <span className="font-mono">{line.sku}</span>
                            <span>مقدار {formatNumber(line.quantity)}</span>
                            <span>بهای واحد {formatMoneyRial(line.unitCost)}</span>
                            <span>ارزش {formatMoneyRial(line.value)}</span>
                          </li>
                        ))}
                      </ul>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))
          )}
        </TableBody>
      </Table>
      {total > PAGE_SIZE && (
        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>صفحه {formatNumber(page)} از {formatNumber(pages)}</span>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>قبلی</Button>
            <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>بعدی</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
