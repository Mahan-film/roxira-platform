"use client";

import { History } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatRial } from "@/lib/format";
import { PAYSLIP_STATUS_LABELS, type Payslip } from "@/types/hr";

interface PayslipHistoryTableProps {
  payslips: Payslip[];
  isLoading?: boolean;
}

/**
 * جدول سابقه فیش‌های حقوقی صادرشده و سند خودکار نظیر هر فیش
 * (`GET /enterprise-hub/hr/payslips`).
 */
export function PayslipHistoryTable({
  payslips,
  isLoading = false,
}: PayslipHistoryTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="size-4 text-sky-500" />
          سابقه فیش‌های حقوقی
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && payslips.length === 0 ? (
          <Skeleton className="h-10 w-full" />
        ) : payslips.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            هنوز فیش حقوقی صادر نشده است.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>شماره فیش</TableHead>
                <TableHead>کارمند</TableHead>
                <TableHead>دوره</TableHead>
                <TableHead>ناخالص</TableHead>
                <TableHead>بیمه و مالیات</TableHead>
                <TableHead>خالص</TableHead>
                <TableHead>سند حسابداری</TableHead>
                <TableHead>وضعیت</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payslips.map((payslip) => (
                <TableRow key={payslip.id}>
                  <TableCell className="font-mono text-xs" dir="ltr">
                    {payslip.payslipNumber}
                  </TableCell>
                  <TableCell>{payslip.employeeFullName}</TableCell>
                  <TableCell>
                    {payslip.periodYear}/{payslip.periodMonth}
                  </TableCell>
                  <TableCell>{formatRial(payslip.grossPay)}</TableCell>
                  <TableCell>
                    {formatRial(
                      payslip.insuranceDeduction + payslip.incomeTax,
                    )}
                  </TableCell>
                  <TableCell className="font-semibold">
                    {formatRial(payslip.netPay)}
                  </TableCell>
                  <TableCell className="font-mono text-xs" dir="ltr">
                    {payslip.journalEntryNumber ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {PAYSLIP_STATUS_LABELS[payslip.status]}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
