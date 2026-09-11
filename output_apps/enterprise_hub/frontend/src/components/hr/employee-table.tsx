"use client";

import { FileText, RefreshCw, UserRoundSearch } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { formatPersianDate } from "@/lib/format";
import {
  EMPLOYEE_STATUS_LABELS,
  EmployeeStatus,
  type Employee,
} from "@/types/hr";

interface EmployeeTableProps {
  employees: Employee[];
  selectedEmployeeId: number | null;
  isLoading?: boolean;
  onSelect: (employee: Employee) => void;
  onRefresh?: () => void;
}

function statusVariant(
  status: EmployeeStatus,
): "default" | "secondary" | "destructive" {
  if (status === EmployeeStatus.ACTIVE) {
    return "default";
  }
  if (status === EmployeeStatus.ON_LEAVE) {
    return "secondary";
  }
  return "destructive";
}

/**
 * جدول پرسنل و کارگزینی با امکان انتخاب کارمند جهت پیش‌نمایش فیش حقوقی
 * (`GET /enterprise-hub/hr/employees`).
 */
export function EmployeeTable({
  employees,
  selectedEmployeeId,
  isLoading = false,
  onSelect,
  onRefresh,
}: EmployeeTableProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <UserRoundSearch className="size-4 text-indigo-500" />
          فهرست پرسنل
        </CardTitle>
        {onRefresh && (
          <Button variant="outline" size="sm" onClick={onRefresh}>
            <RefreshCw className="size-3.5" />
            به‌روزرسانی
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isLoading && employees.length === 0 ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : employees.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            هنوز پرسنلی ثبت نشده است. از فرم بالا نخستین کارمند را اضافه کنید.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>کد پرسنلی</TableHead>
                <TableHead>نام و نام خانوادگی</TableHead>
                <TableHead>کد ملی</TableHead>
                <TableHead>سمت / واحد</TableHead>
                <TableHead>تاریخ استخدام</TableHead>
                <TableHead>وضعیت</TableHead>
                <TableHead className="text-right">فیش حقوقی</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employees.map((employee) => {
                const isSelected = employee.id === selectedEmployeeId;
                return (
                  <TableRow
                    key={employee.id}
                    data-state={isSelected ? "selected" : undefined}
                  >
                    <TableCell className="font-mono text-xs" dir="ltr">
                      {employee.employeeNumber}
                    </TableCell>
                    <TableCell className="font-medium">
                      {employee.fullName}
                    </TableCell>
                    <TableCell className="font-mono text-xs" dir="ltr">
                      {employee.nationalId}
                    </TableCell>
                    <TableCell>
                      <span className="block text-sm">{employee.jobTitle}</span>
                      <span className="block text-xs text-muted-foreground">
                        {employee.department}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatPersianDate(employee.hireDate)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(employee.status)}>
                        {EMPLOYEE_STATUS_LABELS[employee.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant={isSelected ? "default" : "outline"}
                        size="sm"
                        onClick={() => onSelect(employee)}
                      >
                        <FileText className="size-3.5" />
                        پیش‌نمایش
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
