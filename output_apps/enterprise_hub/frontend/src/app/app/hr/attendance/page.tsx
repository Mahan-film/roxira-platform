"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CalendarCheck,
  CheckCircle2,
  Clock,
  Coins,
  FileCheck2,
  Plus,
  RefreshCw,
  Search,
  UsersRound,
  XCircle,
} from "lucide-react";

import { ErrorNotice, LoadingLine, PageHeader, loadErrorMessage } from "@/components/app/app-ui";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createStaffLoan,
  listAttendances,
  listEmployees,
  listLeaves,
  listStaffLoans,
  recordAttendance,
  requestLeave,
  reviewLeave,
} from "@/lib/api/hr-client";
import { formatMoneyRial, formatNumber } from "@/lib/fa-format";
import {
  LEAVE_STATUS_LABELS,
  LEAVE_TYPE_LABELS,
  LOAN_STATUS_LABELS,
  LeaveStatus,
  LeaveType,
  LoanStatus,
  type Employee,
  type EmployeeAttendance,
  type EmployeeLeave,
  type StaffLoan,
} from "@/types/hr";

const JALALI_MONTHS = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
];

export default function SuiteAttendanceLeaveLoanPage() {
  const [tab, setTab] = useState<"attendance" | "leave" | "loan">("attendance");
  const [year, setYear] = useState<number>(1405);
  const [month, setMonth] = useState<number>(1);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendances, setAttendances] = useState<EmployeeAttendance[]>([]);
  const [leaves, setLeaves] = useState<EmployeeLeave[]>([]);
  const [loans, setLoans] = useState<StaffLoan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Attendance Form modal state
  const [showAttendanceModal, setShowAttendanceModal] = useState(false);
  const [attEmployeeId, setAttEmployeeId] = useState<number>(0);
  const [attWorkDays, setAttWorkDays] = useState<number>(30);
  const [attOvertime, setAttOvertime] = useState<number>(0);
  const [attNight, setAttNight] = useState<number>(0);
  const [attHoliday, setAttHoliday] = useState<number>(0);
  const [attAbsence, setAttAbsence] = useState<number>(0);
  const [attUnpaidLeave, setAttUnpaidLeave] = useState<number>(0);
  const [attNotes, setAttNotes] = useState<string>("");

  // Leave Form modal state
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [leaveEmployeeId, setLeaveEmployeeId] = useState<number>(0);
  const [leaveType, setLeaveType] = useState<LeaveType>(LeaveType.ANNUAL);
  const [leaveStart, setLeaveStart] = useState<string>("");
  const [leaveEnd, setLeaveEnd] = useState<string>("");
  const [leaveDays, setLeaveDays] = useState<number>(1);
  const [leaveDesc, setLeaveDesc] = useState<string>("");

  // Loan Form modal state
  const [showLoanModal, setShowLoanModal] = useState(false);
  const [loanEmployeeId, setLoanEmployeeId] = useState<number>(0);
  const [loanTitle, setLoanTitle] = useState<string>("");
  const [loanPrincipal, setLoanPrincipal] = useState<number>(12_000_000);
  const [loanInstalment, setLoanInstalment] = useState<number>(1_000_000);
  const [loanTotalInstalments, setLoanTotalInstalments] = useState<number>(12);
  const [canReadLoans, setCanReadLoans] = useState<boolean>(true);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [empRes, attRes, leaveRes] = await Promise.all([
        listEmployees({ limit: 100 }),
        listAttendances({ periodYear: year, periodMonth: month }),
        listLeaves(),
      ]);
      setEmployees(empRes.data);
      setAttendances(attRes);
      setLeaves(leaveRes);

      // GET /hr/loans allows owner and hr only. Load separately so a 403
      // never breaks the page for admin or read_only (LESSONS 17).
      try {
        const loanRes = await listStaffLoans();
        setLoans(loanRes);
        setCanReadLoans(true);
      } catch (err: any) {
        if (err?.statusCode === 403 || err?.status === 403) {
          setLoans([]);
          setCanReadLoans(false);
        } else {
          setError(loadErrorMessage(err));
        }
      }

      if (empRes.data.length > 0) {
        if (!attEmployeeId) setAttEmployeeId(empRes.data[0].id);
        if (!leaveEmployeeId) setLeaveEmployeeId(empRes.data[0].id);
        if (!loanEmployeeId) setLoanEmployeeId(empRes.data[0].id);
      }
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [year, month]);

  const handleSaveAttendance = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await recordAttendance({
        employeeId: Number(attEmployeeId),
        periodYear: year,
        periodMonth: month,
        workDays: Number(attWorkDays),
        overtimeHours: Number(attOvertime),
        nightHours: Number(attNight),
        holidayHours: Number(attHoliday),
        absenceDays: Number(attAbsence),
        unpaidLeaveDays: Number(attUnpaidLeave),
        notes: attNotes,
      });
      setShowAttendanceModal(false);
      loadData();
    } catch (err) {
      setError(loadErrorMessage(err));
    }
  };

  const handleRequestLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await requestLeave({
        employeeId: Number(leaveEmployeeId),
        leaveType,
        startDate: leaveStart,
        endDate: leaveEnd,
        days: Number(leaveDays),
        description: leaveDesc,
      });
      setShowLeaveModal(false);
      loadData();
    } catch (err) {
      setError(loadErrorMessage(err));
    }
  };

  const handleReviewLeave = async (id: number, status: LeaveStatus) => {
    try {
      await reviewLeave(id, { status, approvedBy: "مدیر اداری" });
      loadData();
    } catch (err) {
      setError(loadErrorMessage(err));
    }
  };

  const handleCreateLoan = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createStaffLoan({
        employeeId: Number(loanEmployeeId),
        title: loanTitle,
        principalAmount: Number(loanPrincipal),
        instalmentAmount: Number(loanInstalment),
        totalInstalments: Number(loanTotalInstalments),
      });
      setShowLoanModal(false);
      loadData();
    } catch (err) {
      setError(loadErrorMessage(err));
    }
  };

  return (
    <EnterpriseRouteGuard>
      <PageHeader
        title="کارکرد، مرخصی و وام‌های پرسنلی"
        description="مدیریت حضور و غیاب ماهانه، درخواست و تأیید مرخصی، و وام‌های پرسنلی متصل به فیش حقوقی"
      />

      <div className="flex gap-2 border-b border-border mb-6">
        <button
          type="button"
          onClick={() => setTab("attendance")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "attendance"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <CalendarCheck className="w-4 h-4 inline-block ml-1.5" />
          حضور و غیاب ماهانه
        </button>
        <button
          type="button"
          onClick={() => setTab("leave")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "leave"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <FileCheck2 className="w-4 h-4 inline-block ml-1.5" />
          مرخصی‌ها
        </button>
        {canReadLoans && (
          <button
            type="button"
            onClick={() => setTab("loan")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === "loan"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Coins className="w-4 h-4 inline-block ml-1.5" />
            وام و مساعده پرسنلی
          </button>
        )}
      </div>

      {error && <ErrorNotice title="خطا" message={error} />}

      {tab === "attendance" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <Label className="text-sm">دوره:</Label>
              <select
                className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
              >
                {JALALI_MONTHS.map((m, idx) => (
                  <option key={m} value={idx + 1}>
                    {m}
                  </option>
                ))}
              </select>
              <Input
                type="number"
                className="w-24"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
              />
              <Button variant="outline" size="sm" onClick={loadData}>
                <RefreshCw className="w-3.5 h-3.5 ml-1" />
                تازه‌سازی
              </Button>
            </div>
            <Button onClick={() => setShowAttendanceModal(true)}>
              <Plus className="w-4 h-4 ml-1.5" />
              ثبت کارکرد پرسنل
            </Button>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">کارکرد ثبت‌شده دوره {year}/{month}</CardTitle>
              <CardDescription>
                اطلاعات کارکرد به‌صورت خودکار در ماژول حقوق و دستمزد مبنای محاسبه اضافه‌کاری و کسورات قرار می‌گیرد.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <LoadingLine show={loading} />
              ) : attendances.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  هیچ کارکردی برای این دوره ثبت نشده است. از دکمه «ثبت کارکرد پرسنل» استفاده کنید.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>نام کارمند</TableHead>
                      <TableHead>کد پرسنلی</TableHead>
                      <TableHead>کارکرد (روز)</TableHead>
                      <TableHead>اضافه‌کاری (ساعت)</TableHead>
                      <TableHead>شب‌کاری (ساعت)</TableHead>
                      <TableHead>تعطیل‌کاری (ساعت)</TableHead>
                      <TableHead>غیبت (روز)</TableHead>
                      <TableHead>مرخصی بدون حقوق</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {attendances.map((att) => (
                      <TableRow key={att.id}>
                        <TableCell className="font-medium">{att.employeeName ?? `کارمند ${att.employeeId}`}</TableCell>
                        <TableCell>{att.employeeNumber ?? "-"}</TableCell>
                        <TableCell>{formatNumber(att.workDays)}</TableCell>
                        <TableCell>{formatNumber(att.overtimeHours)}</TableCell>
                        <TableCell>{formatNumber(att.nightHours)}</TableCell>
                        <TableCell>{formatNumber(att.holidayHours)}</TableCell>
                        <TableCell>{formatNumber(att.absenceDays)}</TableCell>
                        <TableCell>{formatNumber(att.unpaidLeaveDays)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "leave" && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-base font-medium">فهرست درخواست‌های مرخصی</h3>
            <Button onClick={() => setShowLeaveModal(true)}>
              <Plus className="w-4 h-4 ml-1.5" />
              درخواست مرخصی جدید
            </Button>
          </div>

          <Card>
            <CardContent className="pt-4">
              {loading ? (
                <LoadingLine show={loading} />
              ) : leaves.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  درخواست مرخصی ثبت نشده است.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>کارمند</TableHead>
                      <TableHead>نوع مرخصی</TableHead>
                      <TableHead>از تاریخ</TableHead>
                      <TableHead>تا تاریخ</TableHead>
                      <TableHead>مدت (روز)</TableHead>
                      <TableHead>وضعیت</TableHead>
                      <TableHead>عملیات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leaves.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="font-medium">{l.employeeName ?? `کارمند ${l.employeeId}`}</TableCell>
                        <TableCell>{l.leaveTypeLabel}</TableCell>
                        <TableCell>{l.startDate}</TableCell>
                        <TableCell>{l.endDate}</TableCell>
                        <TableCell>{formatNumber(l.days)}</TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              l.status === LeaveStatus.APPROVED
                                ? "default"
                                : l.status === LeaveStatus.REJECTED
                                ? "destructive"
                                : "outline"
                            }
                          >
                            {l.statusLabel}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {l.status === LeaveStatus.PENDING && (
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-green-600 h-7 px-2"
                                onClick={() => handleReviewLeave(l.id, LeaveStatus.APPROVED)}
                              >
                                <CheckCircle2 className="w-3.5 h-3.5 ml-1" />
                                تأیید
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-destructive h-7 px-2"
                                onClick={() => handleReviewLeave(l.id, LeaveStatus.REJECTED)}
                              >
                                <XCircle className="w-3.5 h-3.5 ml-1" />
                                رد
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "loan" && canReadLoans && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-base font-medium">وام‌ها و مساعده‌های پرسنلی</h3>
            <Button onClick={() => setShowLoanModal(true)}>
              <Plus className="w-4 h-4 ml-1.5" />
              تعریف وام جدید
            </Button>
          </div>

          <Card>
            <CardContent className="pt-4">
              {loading ? (
                <LoadingLine show={loading} />
              ) : loans.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  هیچ وام پرسنلی ثبت نشده است.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>کارمند</TableHead>
                      <TableHead>عنوان وام</TableHead>
                      <TableHead>اصل مبلغ (ریال)</TableHead>
                      <TableHead>مبلغ قسط (ریال)</TableHead>
                      <TableHead>اقساط پرداخت‌شده</TableHead>
                      <TableHead>مانده (ریال)</TableHead>
                      <TableHead>وضعیت</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loans.map((loan) => (
                      <TableRow key={loan.id}>
                        <TableCell className="font-medium">{loan.employeeName ?? `کارمند ${loan.employeeId}`}</TableCell>
                        <TableCell>{loan.title}</TableCell>
                        <TableCell>{formatMoneyRial(loan.principalAmount)}</TableCell>
                        <TableCell>{formatMoneyRial(loan.instalmentAmount)}</TableCell>
                        <TableCell>
                          {formatNumber(loan.paidInstalments)} از {formatNumber(loan.totalInstalments)}
                        </TableCell>
                        <TableCell>{formatMoneyRial(loan.remainingAmount)}</TableCell>
                        <TableCell>
                          <Badge
                            variant={loan.status === LoanStatus.ACTIVE ? "default" : "outline"}
                          >
                            {loan.statusLabel}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Attendance Modal */}
      {showAttendanceModal && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>ثبت کارکرد پرسنل</CardTitle>
              <CardDescription>دوره {year}/{month}</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSaveAttendance} className="space-y-3">
                <div>
                  <Label>انتخاب کارمند</Label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-1"
                    value={attEmployeeId}
                    onChange={(e) => setAttEmployeeId(Number(e.target.value))}
                  >
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.firstName} {emp.lastName} ({emp.employeeNumber})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>کارکرد موثر (روز)</Label>
                    <Input
                      type="number"
                      min={0}
                      max={31}
                      step={0.5}
                      value={attWorkDays}
                      onChange={(e) => setAttWorkDays(Number(e.target.value))}
                    />
                  </div>
                  <div>
                    <Label>اضافه‌کاری (ساعت)</Label>
                    <Input
                      type="number"
                      min={0}
                      step={0.5}
                      value={attOvertime}
                      onChange={(e) => setAttOvertime(Number(e.target.value))}
                    />
                  </div>
                  <div>
                    <Label>شب‌کاری (ساعت)</Label>
                    <Input
                      type="number"
                      min={0}
                      step={0.5}
                      value={attNight}
                      onChange={(e) => setAttNight(Number(e.target.value))}
                    />
                  </div>
                  <div>
                    <Label>تعطیل‌کاری (ساعت)</Label>
                    <Input
                      type="number"
                      min={0}
                      step={0.5}
                      value={attHoliday}
                      onChange={(e) => setAttHoliday(Number(e.target.value))}
                    />
                  </div>
                  <div>
                    <Label>غیبت غیرموجه (روز)</Label>
                    <Input
                      type="number"
                      min={0}
                      max={31}
                      step={0.5}
                      value={attAbsence}
                      onChange={(e) => setAttAbsence(Number(e.target.value))}
                    />
                  </div>
                  <div>
                    <Label>مرخصی بدون حقوق (روز)</Label>
                    <Input
                      type="number"
                      min={0}
                      max={31}
                      step={0.5}
                      value={attUnpaidLeave}
                      onChange={(e) => setAttUnpaidLeave(Number(e.target.value))}
                    />
                  </div>
                </div>
                <div>
                  <Label>یادداشت</Label>
                  <Input
                    value={attNotes}
                    onChange={(e) => setAttNotes(e.target.value)}
                    placeholder="توضیحات اختیاری"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-3">
                  <Button type="button" variant="outline" onClick={() => setShowAttendanceModal(false)}>
                    انصراف
                  </Button>
                  <Button type="submit">ثبت کارکرد</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Leave Modal */}
      {showLeaveModal && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>ثبت درخواست مرخصی</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleRequestLeave} className="space-y-3">
                <div>
                  <Label>کارمند</Label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-1"
                    value={leaveEmployeeId}
                    onChange={(e) => setLeaveEmployeeId(Number(e.target.value))}
                  >
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.firstName} {emp.lastName} ({emp.employeeNumber})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>نوع مرخصی</Label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-1"
                    value={leaveType}
                    onChange={(e) => setLeaveType(e.target.value as LeaveType)}
                  >
                    <option value={LeaveType.ANNUAL}>استحقاقی</option>
                    <option value={LeaveType.UNPAID}>بدون حقوق</option>
                    <option value={LeaveType.SICK}>استعلاجی</option>
                    <option value={LeaveType.SPECIAL}>مناسبتی (ازدواج/فوت)</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>از تاریخ</Label>
                    <Input
                      placeholder="1405/01/10"
                      value={leaveStart}
                      onChange={(e) => setLeaveStart(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <Label>تا تاریخ</Label>
                    <Input
                      placeholder="1405/01/12"
                      value={leaveEnd}
                      onChange={(e) => setLeaveEnd(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <div>
                  <Label>تعداد روز</Label>
                  <Input
                    type="number"
                    step="0.5"
                    min="0.5"
                    value={leaveDays}
                    onChange={(e) => setLeaveDays(Number(e.target.value))}
                    required
                  />
                </div>
                <div>
                  <Label>توضیحات</Label>
                  <Input
                    value={leaveDesc}
                    onChange={(e) => setLeaveDesc(e.target.value)}
                    placeholder="علت مرخصی"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-3">
                  <Button type="button" variant="outline" onClick={() => setShowLeaveModal(false)}>
                    انصراف
                  </Button>
                  <Button type="submit">ارسال درخواست</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Loan Modal */}
      {showLoanModal && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>تعریف وام یا مساعده پرسنلی</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreateLoan} className="space-y-3">
                <div>
                  <Label>کارمند</Label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-1"
                    value={loanEmployeeId}
                    onChange={(e) => setLoanEmployeeId(Number(e.target.value))}
                  >
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.firstName} {emp.lastName} ({emp.employeeNumber})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>عنوان وام / مساعده</Label>
                  <Input
                    placeholder="وام ضروری، وام مسکن..."
                    value={loanTitle}
                    onChange={(e) => setLoanTitle(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <Label>اصل مبلغ وام (ریال)</Label>
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={loanPrincipal}
                    onChange={(e) => setLoanPrincipal(Number(e.target.value))}
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>مبلغ قسط ماهانه (ریال)</Label>
                    <Input
                      type="number"
                      min={1}
                      max={loanPrincipal || undefined}
                      step={1}
                      value={loanInstalment}
                      onChange={(e) => setLoanInstalment(Number(e.target.value))}
                      required
                    />
                  </div>
                  <div>
                    <Label>تعداد کل اقساط</Label>
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      value={loanTotalInstalments}
                      onChange={(e) => setLoanTotalInstalments(Number(e.target.value))}
                      required
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-3">
                  <Button type="button" variant="outline" onClick={() => setShowLoanModal(false)}>
                    انصراف
                  </Button>
                  <Button type="submit">تعریف وام</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </EnterpriseRouteGuard>
  );
}
