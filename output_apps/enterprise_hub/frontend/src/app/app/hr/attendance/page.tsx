"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Calculator,
  CalendarCheck,
  CheckCircle2,
  Clock,
  Coins,
  FileCheck2,
  Plus,
  RefreshCw,
  UploadCloud,
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
import {
  AttendanceEventKind,
  AttendanceEventSource,
  DailyAttendanceStatus,
  DailyAttendanceSummaryDto,
  ImportAttendanceResultDto,
  RollupAttendanceResultDto,
  getDailyAttendanceSummary,
  importAttendanceCsv,
  recordAttendanceEvent,
  rollupMonthlyAttendance,
} from "@/lib/api/attendance-events-client";
import { formatMoneyRial, formatNumber } from "@/lib/fa-format";
import { tehranWallTimeToIso } from "@/lib/tehran-time";
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

function formatMinutes(mins: number): string {
  if (!mins || mins <= 0) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m > 0) return `${formatNumber(h)} ساعت و ${formatNumber(m)} دقیقه`;
  if (h > 0) return `${formatNumber(h)} ساعت`;
  return `${formatNumber(m)} دقیقه`;
}

function formatTimeString(isoString: string | null): string {
  if (!isoString) return "—";
  try {
    const parts = isoString.split("T");
    if (parts.length > 1) {
      return parts[1].substring(0, 5);
    }
    const d = new Date(isoString);
    return isNaN(d.getTime()) ? isoString : d.toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return isoString;
  }
}

export default function SuiteAttendanceLeaveLoanPage() {
  const [tab, setTab] = useState<"daily" | "attendance" | "leave" | "loan">("daily");
  const [year, setYear] = useState<number>(1405);
  const [month, setMonth] = useState<number>(1);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendances, setAttendances] = useState<EmployeeAttendance[]>([]);
  const [leaves, setLeaves] = useState<EmployeeLeave[]>([]);
  const [loans, setLoans] = useState<StaffLoan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Daily attendance state (T129)
  const [dailyDate, setDailyDate] = useState<string>(() => new Date().toISOString().split("T")[0]);
  const [dailyBranchId, setDailyBranchId] = useState<string>("all");
  const [dailySummary, setDailySummary] = useState<DailyAttendanceSummaryDto | null>(null);
  const [dailyLoading, setDailyLoading] = useState<boolean>(false);
  const [dailySearch, setDailySearch] = useState<string>("");

  // Clock Event modal state
  const [showClockModal, setShowClockModal] = useState<boolean>(false);
  const [clockEmployeeId, setClockEmployeeId] = useState<number>(0);
  const [clockKind, setClockKind] = useState<AttendanceEventKind>(AttendanceEventKind.IN);
  const [clockTime, setClockTime] = useState<string>("");
  const [clockDate, setClockDate] = useState<string>(() => new Date().toISOString().split("T")[0]);
  const [clockBranchId, setClockBranchId] = useState<number | undefined>(undefined);
  const [clockNotes, setClockNotes] = useState<string>("");
  const [clockSubmitting, setClockSubmitting] = useState<boolean>(false);

  // CSV Import modal state
  const [showCsvModal, setShowCsvModal] = useState<boolean>(false);
  const [csvContent, setCsvContent] = useState<string>("");
  const [csvBranchId, setCsvBranchId] = useState<number | undefined>(undefined);
  const [csvResult, setCsvResult] = useState<ImportAttendanceResultDto | null>(null);
  const [csvSubmitting, setCsvSubmitting] = useState<boolean>(false);

  // Rollup modal state
  const [showRollupModal, setShowRollupModal] = useState<boolean>(false);
  const [rollupYear, setRollupYear] = useState<number>(1405);
  const [rollupMonth, setRollupMonth] = useState<number>(1);
  const [rollupEmployeeId, setRollupEmployeeId] = useState<number | undefined>(undefined);
  const [rollupResult, setRollupResult] = useState<RollupAttendanceResultDto | null>(null);
  const [rollupSubmitting, setRollupSubmitting] = useState<boolean>(false);

  // Monthly Attendance Form modal state
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

  const loadDailyData = useCallback(async () => {
    setDailyLoading(true);
    setError(null);
    try {
      const branchNum = dailyBranchId !== "all" ? Number(dailyBranchId) : undefined;
      const res = await getDailyAttendanceSummary({
        date: dailyDate,
        branchId: branchNum,
      });
      setDailySummary(res);
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setDailyLoading(false);
    }
  }, [dailyDate, dailyBranchId]);

  const loadData = useCallback(async () => {
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

      try {
        const loanRes = await listStaffLoans();
        setLoans(loanRes);
        setCanReadLoans(true);
      } catch (err: unknown) {
        const status = (err as { statusCode?: number; status?: number })?.statusCode || (err as { status?: number })?.status;
        if (status === 403) {
          setLoans([]);
          setCanReadLoans(false);
        } else {
          setError(loadErrorMessage(err));
        }
      }

      if (empRes.data.length > 0) {
        setAttEmployeeId((prev) => prev || empRes.data[0].id);
        setLeaveEmployeeId((prev) => prev || empRes.data[0].id);
        setLoanEmployeeId((prev) => prev || empRes.data[0].id);
        setClockEmployeeId((prev) => prev || empRes.data[0].id);
      }
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadData();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadData]);

  useEffect(() => {
    if (tab === "daily") {
      const timer = setTimeout(() => {
        void loadDailyData();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [tab, loadDailyData]);

  const handleRecordClockEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    setClockSubmitting(true);
    setError(null);
    try {
      let occurredAt: string | undefined = undefined;
      if (clockDate) {
        const timePart = clockTime || "08:00";
        // Wall time is Asia/Tehran regardless of the browser time zone.
        occurredAt = tehranWallTimeToIso(clockDate, timePart) ?? new Date().toISOString();
      }
      await recordAttendanceEvent({
        employeeId: Number(clockEmployeeId),
        kind: clockKind,
        occurredAt,
        branchId: clockBranchId ? Number(clockBranchId) : undefined,
        source: AttendanceEventSource.MANUAL,
        notes: clockNotes.trim() || undefined,
      });
      setShowClockModal(false);
      setClockNotes("");
      loadDailyData();
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setClockSubmitting(false);
    }
  };

  const handleImportCsv = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csvContent.trim()) return;
    setCsvSubmitting(true);
    setError(null);
    try {
      const res = await importAttendanceCsv({
        csvData: csvContent.trim(),
        branchId: csvBranchId ? Number(csvBranchId) : undefined,
      });
      setCsvResult(res);
      loadDailyData();
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setCsvSubmitting(false);
    }
  };

  const handleRollup = async (e: React.FormEvent) => {
    e.preventDefault();
    setRollupSubmitting(true);
    setError(null);
    try {
      const res = await rollupMonthlyAttendance({
        periodYear: Number(rollupYear),
        periodMonth: Number(rollupMonth),
        employeeId: rollupEmployeeId ? Number(rollupEmployeeId) : undefined,
      });
      setRollupResult(res);
      loadData();
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setRollupSubmitting(false);
    }
  };

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

  const filteredDailyRecords = (dailySummary?.records || []).filter((rec) => {
    if (!dailySearch.trim()) return true;
    const term = dailySearch.toLowerCase().trim();
    return (
      rec.fullName.toLowerCase().includes(term) ||
      rec.employeeNumber.toLowerCase().includes(term)
    );
  });

  return (
    <EnterpriseRouteGuard>
      <PageHeader
        title="حضور و غیاب و کارکرد پرسنلی"
        description="ردیابی تردد روزانه و بیومتریک، مرخصی‌ها، کارکرد ماهانه و وام‌های متصل به حقوق"
      />

      <div className="flex gap-2 border-b border-border mb-6">
        <button
          type="button"
          onClick={() => setTab("daily")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "daily"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Clock className="w-4 h-4 inline-block ml-1.5" />
          حضور روزانه
        </button>
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
          کارکرد ماهانه
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

      {/* ============================================================== */}
      {/* TAB 1: DAILY ATTENDANCE (T129)                                */}
      {/* ============================================================== */}
      {tab === "daily" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Label className="text-sm text-muted-foreground">تاریخ:</Label>
                <Input
                  type="date"
                  className="w-40 text-sm"
                  value={dailyDate}
                  onChange={(e) => setDailyDate(e.target.value)}
                />
              </div>

              <div className="flex items-center gap-2">
                <Label className="text-sm text-muted-foreground">شعبه:</Label>
                <select
                  className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                  value={dailyBranchId}
                  onChange={(e) => setDailyBranchId(e.target.value)}
                >
                  <option value="all">همه شعب</option>
                  <option value="1">شعبه مرکزی</option>
                  <option value="2">شعبه شرق</option>
                  <option value="3">شعبه غرب</option>
                </select>
              </div>

              <Button variant="outline" size="sm" onClick={loadDailyData} disabled={dailyLoading}>
                <RefreshCw className={`w-3.5 h-3.5 ml-1 ${dailyLoading ? "animate-spin" : ""}`} />
                تازه‌سازی
              </Button>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button size="sm" variant="outline" onClick={() => setShowRollupModal(true)}>
                <Calculator className="w-3.5 h-3.5 ml-1" />
                تجمیع کارکرد ماهانه
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowCsvModal(true)}>
                <UploadCloud className="w-3.5 h-3.5 ml-1" />
                بارگذاری فایل دستگاه (CSV)
              </Button>
              <Button size="sm" onClick={() => setShowClockModal(true)}>
                <Plus className="w-4 h-4 ml-1" />
                ثبت تردد دستی
              </Button>
            </div>
          </div>

          {/* Daily KPI Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <Card>
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">کل پرسنل</p>
                  <p className="text-2xl font-bold mt-1">
                    {formatNumber(dailySummary?.totalEmployees ?? 0)}
                  </p>
                </div>
                <UsersRound className="w-8 h-8 text-muted-foreground/40" />
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs text-emerald-600 font-medium">حاضرین</p>
                  <p className="text-2xl font-bold mt-1 text-emerald-700">
                    {formatNumber(dailySummary?.presentCount ?? 0)}
                  </p>
                </div>
                <CheckCircle2 className="w-8 h-8 text-emerald-500/40" />
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs text-amber-600 font-medium">با تأخیر</p>
                  <p className="text-2xl font-bold mt-1 text-amber-700">
                    {formatNumber(dailySummary?.lateCount ?? 0)}
                  </p>
                </div>
                <Clock className="w-8 h-8 text-amber-500/40" />
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs text-sky-600 font-medium">در مرخصی</p>
                  <p className="text-2xl font-bold mt-1 text-sky-700">
                    {formatNumber(dailySummary?.onLeaveCount ?? 0)}
                  </p>
                </div>
                <FileCheck2 className="w-8 h-8 text-sky-500/40" />
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs text-destructive font-medium">غایبین</p>
                  <p className="text-2xl font-bold mt-1 text-destructive">
                    {formatNumber(dailySummary?.absentCount ?? 0)}
                  </p>
                </div>
                <XCircle className="w-8 h-8 text-destructive/40" />
              </CardContent>
            </Card>
          </div>

          {/* Daily Attendance Table */}
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">فهرست تردد روزانه پرسنل</CardTitle>
                <CardDescription>
                  گزارش ورود، خروج، تأخیر و ساعت کارکرد واقعی در تاریخ {dailyDate}
                </CardDescription>
              </div>
              <div className="w-64">
                <Input
                  placeholder="جستجوی نام یا کد پرسنلی..."
                  value={dailySearch}
                  onChange={(e) => setDailySearch(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {dailyLoading ? (
                <div className="p-8">
                  <LoadingLine />
                </div>
              ) : filteredDailyRecords.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  رکوردی برای این تاریخ و شعبه یافت نشد.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>کد</TableHead>
                      <TableHead>نام و نام خانوادگی</TableHead>
                      <TableHead>شعبه</TableHead>
                      <TableHead>وضعیت</TableHead>
                      <TableHead>اولین ورود</TableHead>
                      <TableHead>آخرین خروج</TableHead>
                      <TableHead>کارکرد</TableHead>
                      <TableHead>تأخیر</TableHead>
                      <TableHead>تعداد تردد</TableHead>
                      <TableHead className="text-left">عملیات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredDailyRecords.map((rec) => (
                      <TableRow key={rec.employeeId}>
                        <TableCell className="font-mono text-xs">{rec.employeeNumber}</TableCell>
                        <TableCell className="font-medium">{rec.fullName}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {rec.branchId ? `شعبه ${rec.branchId}` : "مرکزی"}
                        </TableCell>
                        <TableCell>
                          {rec.status === DailyAttendanceStatus.PRESENT && (
                            <Badge className="bg-emerald-600/15 text-emerald-700 border-emerald-300">
                              حاضر
                            </Badge>
                          )}
                          {rec.status === DailyAttendanceStatus.LATE && (
                            <Badge className="bg-amber-600/15 text-amber-700 border-amber-300">
                              تأخیر
                            </Badge>
                          )}
                          {rec.status === DailyAttendanceStatus.ON_LEAVE && (
                            <Badge className="bg-sky-600/15 text-sky-700 border-sky-300">
                              مرخصی
                            </Badge>
                          )}
                          {rec.status === DailyAttendanceStatus.ABSENT && (
                            <Badge variant="destructive">غایب</Badge>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {formatTimeString(rec.firstIn)}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {formatTimeString(rec.lastOut)}
                        </TableCell>
                        <TableCell className="text-xs">
                          {formatMinutes(rec.workedMinutes)}
                        </TableCell>
                        <TableCell className="text-xs text-amber-600">
                          {rec.tardinessMinutes > 0 ? `${formatNumber(rec.tardinessMinutes)} دقیقه` : "—"}
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          {formatNumber(rec.eventsCount)}
                        </TableCell>
                        <TableCell className="text-left">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs px-2"
                            onClick={() => {
                              setClockEmployeeId(rec.employeeId);
                              setClockDate(dailyDate);
                              setShowClockModal(true);
                            }}
                          >
                            ثبت تردد
                          </Button>
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

      {/* ============================================================== */}
      {/* TAB 2: MONTHLY ATTENDANCE                                      */}
      {/* ============================================================== */}
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
              <CardTitle className="text-base">
                کارکرد ماه {JALALI_MONTHS[month - 1]} سال {year}
              </CardTitle>
              <CardDescription>
                اطلاعات کارکرد، اضافه‌کار و غیبت‌های پرسنل برای محاسبه فیش حقوقی
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-8">
                  <LoadingLine />
                </div>
              ) : attendances.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  هنوز کارکردی برای این دوره ثبت نشده است.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>نام کارمند</TableHead>
                      <TableHead>کد پرسنلی</TableHead>
                      <TableHead>روزهای کارکرد</TableHead>
                      <TableHead>اضافه‌کاری (ساعت)</TableHead>
                      <TableHead>شب‌کاری (ساعت)</TableHead>
                      <TableHead>تعطیل‌کاری (ساعت)</TableHead>
                      <TableHead>غیبت (روز)</TableHead>
                      <TableHead>مرخصی بدون حقوق (روز)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {attendances.map((att) => (
                      <TableRow key={att.id}>
                        <TableCell className="font-medium">
                          {att.employee
                            ? `${att.employee.firstName} ${att.employee.lastName}`
                            : `کارمند #${att.employeeId}`}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {att.employee?.employeeNumber || "—"}
                        </TableCell>
                        <TableCell>{formatNumber(att.workDays)}</TableCell>
                        <TableCell>{formatNumber(att.overtimeHours)}</TableCell>
                        <TableCell>{formatNumber(att.nightHours)}</TableCell>
                        <TableCell>{formatNumber(att.holidayHours)}</TableCell>
                        <TableCell className="text-destructive">
                          {formatNumber(att.absenceDays)}
                        </TableCell>
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

      {/* ============================================================== */}
      {/* TAB 3: LEAVES                                                  */}
      {/* ============================================================== */}
      {tab === "leave" && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <Button variant="outline" size="sm" onClick={loadData}>
              <RefreshCw className="w-3.5 h-3.5 ml-1" />
              تازه‌سازی
            </Button>
            <Button onClick={() => setShowLeaveModal(true)}>
              <Plus className="w-4 h-4 ml-1.5" />
              درخواست مرخصی جدید
            </Button>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">فهرست درخواست‌های مرخصی</CardTitle>
              <CardDescription>بررسی و تأیید یا رد مرخصی‌های استحقاقی، استعلاجی و ساعتی</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-8">
                  <LoadingLine />
                </div>
              ) : leaves.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  هیچ درخواست مرخصی ثبت نشده است.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>نام کارمند</TableHead>
                      <TableHead>نوع مرخصی</TableHead>
                      <TableHead>از تاریخ</TableHead>
                      <TableHead>تا تاریخ</TableHead>
                      <TableHead>تعداد روز</TableHead>
                      <TableHead>وضعیت</TableHead>
                      <TableHead>عملیات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leaves.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="font-medium">
                          {l.employee
                            ? `${l.employee.firstName} ${l.employee.lastName}`
                            : `کارمند #${l.employeeId}`}
                        </TableCell>
                        <TableCell>{LEAVE_TYPE_LABELS[l.leaveType] || l.leaveType}</TableCell>
                        <TableCell className="font-mono text-xs">{l.startDate}</TableCell>
                        <TableCell className="font-mono text-xs">{l.endDate}</TableCell>
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
                            {LEAVE_STATUS_LABELS[l.status] || l.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {l.status === LeaveStatus.PENDING && (
                            <div className="flex gap-1.5">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                onClick={() => handleReviewLeave(l.id, LeaveStatus.APPROVED)}
                              >
                                تأیید
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                className="h-7 text-xs"
                                onClick={() => handleReviewLeave(l.id, LeaveStatus.REJECTED)}
                              >
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

      {/* ============================================================== */}
      {/* TAB 4: LOANS                                                   */}
      {/* ============================================================== */}
      {tab === "loan" && canReadLoans && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <Button variant="outline" size="sm" onClick={loadData}>
              <RefreshCw className="w-3.5 h-3.5 ml-1" />
              تازه‌سازی
            </Button>
            <Button onClick={() => setShowLoanModal(true)}>
              <Plus className="w-4 h-4 ml-1.5" />
              تعریف وام جدید
            </Button>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">وام و مساعده‌های پرسنلی</CardTitle>
              <CardDescription>
                مدیریت اقساط ماهانه وام‌ها که به‌صورت خودکار از فیش حقوقی کسر می‌گردند
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-8">
                  <LoadingLine />
                </div>
              ) : loans.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  هیچ وام فعالی ثبت نشده است.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>نام کارمند</TableHead>
                      <TableHead>عنوان وام</TableHead>
                      <TableHead>مبلغ کل</TableHead>
                      <TableHead>مبلغ هر قسط</TableHead>
                      <TableHead>اقساط پرداختی</TableHead>
                      <TableHead>مانده</TableHead>
                      <TableHead>وضعیت</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loans.map((ln) => (
                      <TableRow key={ln.id}>
                        <TableCell className="font-medium">
                          {ln.employee
                            ? `${ln.employee.firstName} ${ln.employee.lastName}`
                            : `کارمند #${ln.employeeId}`}
                        </TableCell>
                        <TableCell>{ln.title}</TableCell>
                        <TableCell>{formatMoneyRial(ln.principalAmount)}</TableCell>
                        <TableCell>{formatMoneyRial(ln.instalmentAmount)}</TableCell>
                        <TableCell>
                          {formatNumber(ln.paidInstalments)} از {formatNumber(ln.totalInstalments)}
                        </TableCell>
                        <TableCell className="font-semibold">
                          {formatMoneyRial(ln.remainingAmount)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              ln.status === LoanStatus.ACTIVE
                                ? "default"
                                : ln.status === LoanStatus.SETTLED
                                ? "outline"
                                : "destructive"
                            }
                          >
                            {LOAN_STATUS_LABELS[ln.status] || ln.status}
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

      {/* ============================================================== */}
      {/* MODAL 1: MANUAL CLOCK IN / OUT (T129)                          */}
      {/* ============================================================== */}
      {showClockModal && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>ثبت تردد پرسنل (ورود / خروج دستی)</CardTitle>
              <CardDescription>ثبت رویداد حضور یا خروج جهت بازبینی کارکرد</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleRecordClockEvent} className="space-y-3">
                <div>
                  <Label>کارمند</Label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-1"
                    value={clockEmployeeId}
                    onChange={(e) => setClockEmployeeId(Number(e.target.value))}
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
                    <Label>نوع تردد</Label>
                    <select
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-1"
                      value={clockKind}
                      onChange={(e) => setClockKind(e.target.value as AttendanceEventKind)}
                    >
                      <option value={AttendanceEventKind.IN}>ورود (IN)</option>
                      <option value={AttendanceEventKind.OUT}>خروج (OUT)</option>
                    </select>
                  </div>
                  <div>
                    <Label>شعبه</Label>
                    <select
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-1"
                      value={clockBranchId ?? ""}
                      onChange={(e) =>
                        setClockBranchId(e.target.value ? Number(e.target.value) : undefined)
                      }
                    >
                      <option value="">مرکزی</option>
                      <option value="1">شعبه ۱</option>
                      <option value="2">شعبه ۲</option>
                      <option value="3">شعبه ۳</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>تاریخ</Label>
                    <Input
                      type="date"
                      value={clockDate}
                      onChange={(e) => setClockDate(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <Label>ساعت (HH:mm)</Label>
                    <Input
                      type="time"
                      value={clockTime}
                      onChange={(e) => setClockTime(e.target.value)}
                      placeholder="08:30"
                    />
                  </div>
                </div>

                <div>
                  <Label>توضیحات / یادداشت</Label>
                  <Input
                    placeholder="مثال: مأموریت خارج از شرکت، فراموشی ثبت کارت"
                    value={clockNotes}
                    onChange={(e) => setClockNotes(e.target.value)}
                  />
                </div>

                <div className="flex justify-end gap-2 pt-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowClockModal(false)}
                    disabled={clockSubmitting}
                  >
                    انصراف
                  </Button>
                  <Button type="submit" disabled={clockSubmitting}>
                    {clockSubmitting ? "در حال ثبت..." : "ثبت تردد"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 2: BIOMETRIC CSV IMPORT (T129)                           */}
      {/* ============================================================== */}
      {showCsvModal && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-lg">
            <CardHeader>
              <CardTitle>بارگذاری فایل دستگاه حضور و غیاب (CSV)</CardTitle>
              <CardDescription>
                ایمپورت فایل لاگ دستگاه ساعت‌زنی بیومتریک یا کارت‌خوان
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleImportCsv} className="space-y-3">
                <div className="rounded-md bg-muted/60 p-3 text-xs text-muted-foreground space-y-1">
                  <p className="font-semibold text-foreground">فرمت ردیف‌های فایل CSV:</p>
                  <p className="font-mono">employee_number,occurred_at,event_type</p>
                  <p>مثال: <span className="font-mono">EMP-001,2026-11-16T08:10:00Z,in</span></p>
                </div>

                <div>
                  <Label>انتخاب شعبه دستگاه (اختیاری)</Label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-1"
                    value={csvBranchId ?? ""}
                    onChange={(e) =>
                      setCsvBranchId(e.target.value ? Number(e.target.value) : undefined)
                    }
                  >
                    <option value="">مرکزی</option>
                    <option value="1">شعبه ۱</option>
                    <option value="2">شعبه ۲</option>
                  </select>
                </div>

                <div>
                  <Label>محتوای CSV یا انتخاب فایل</Label>
                  <input
                    type="file"
                    accept=".csv,.txt"
                    className="block w-full text-xs text-muted-foreground file:ml-2 file:py-1 file:px-3 file:rounded-md file:border file:border-input file:text-xs file:font-medium file:bg-background hover:file:bg-muted my-2"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                          setCsvContent(String(ev.target?.result || ""));
                        };
                        reader.readAsText(file);
                      }
                    }}
                  />
                  <textarea
                    rows={6}
                    className="w-full rounded-md border border-input bg-background p-2 text-xs font-mono"
                    placeholder="EMP-001,2026-11-16T08:00:00Z,in&#10;EMP-001,2026-11-16T17:00:00Z,out"
                    value={csvContent}
                    onChange={(e) => setCsvContent(e.target.value)}
                    required
                  />
                </div>

                {csvResult && (
                  <div className="rounded-md border p-3 bg-muted/30 text-xs space-y-1">
                    <p className="font-semibold text-emerald-700">نتیجه پردازش فایل:</p>
                    <div className="flex gap-4">
                      <span>کل ردیف‌ها: {formatNumber(csvResult.totalRows)}</span>
                      <span className="text-emerald-600">ثبت‌شده: {formatNumber(csvResult.inserted)}</span>
                      <span className="text-amber-600">ردشده: {formatNumber(csvResult.skipped)}</span>
                    </div>
                    {csvResult.errors.length > 0 && (
                      <div className="text-destructive mt-1 max-h-24 overflow-y-auto">
                        {csvResult.errors.map((err, i) => (
                          <p key={i}>• {err}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowCsvModal(false);
                      setCsvResult(null);
                    }}
                    disabled={csvSubmitting}
                  >
                    بستن
                  </Button>
                  <Button type="submit" disabled={csvSubmitting || !csvContent.trim()}>
                    {csvSubmitting ? "در حال پردازش..." : "پردازش و ثبت در دیتابیس"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 3: MONTHLY ROLLUP (T129)                                 */}
      {/* ============================================================== */}
      {showRollupModal && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>تجمیع کارکرد روزانه به کارکرد ماهانه</CardTitle>
              <CardDescription>
                محاسبه ساعات کارکرد واقعی، اضافه کار و غیبت و ثبت خودکار در جدول کارکرد حقوق
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleRollup} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>ماه دوره</Label>
                    <select
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-1"
                      value={rollupMonth}
                      onChange={(e) => setRollupMonth(Number(e.target.value))}
                    >
                      {JALALI_MONTHS.map((m, idx) => (
                        <option key={m} value={idx + 1}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label>سال دوره</Label>
                    <Input
                      type="number"
                      className="mt-1"
                      value={rollupYear}
                      onChange={(e) => setRollupYear(Number(e.target.value))}
                      required
                    />
                  </div>
                </div>

                <div>
                  <Label>پرسنل هدف (اختیاری)</Label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-1"
                    value={rollupEmployeeId ?? ""}
                    onChange={(e) =>
                      setRollupEmployeeId(e.target.value ? Number(e.target.value) : undefined)
                    }
                  >
                    <option value="">همه پرسنل فعال</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.firstName} {emp.lastName} ({emp.employeeNumber})
                      </option>
                    ))}
                  </select>
                </div>

                {rollupResult && (
                  <div className="rounded-md border p-3 bg-emerald-50 dark:bg-emerald-950/20 text-xs space-y-1">
                    <p className="font-semibold text-emerald-800 dark:text-emerald-300">
                      تجمیع کارکرد با موفقیت انجام شد:
                    </p>
                    <p>
                      دوره: {JALALI_MONTHS[rollupResult.periodMonth - 1]} {rollupResult.periodYear}
                    </p>
                    <p>پرسنل بررسی‌شده: {formatNumber(rollupResult.processedEmployees)}</p>
                    <p>رکوردهای به‌روزشده کارکرد: {formatNumber(rollupResult.updatedRecords)}</p>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowRollupModal(false);
                      setRollupResult(null);
                    }}
                    disabled={rollupSubmitting}
                  >
                    بستن
                  </Button>
                  <Button type="submit" disabled={rollupSubmitting}>
                    {rollupSubmitting ? "در حال محاسبه..." : "محاسبه و تجمیع"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 4: RECORD MONTHLY ATTENDANCE                             */}
      {/* ============================================================== */}
      {showAttendanceModal && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>ثبت دستی کارکرد ماهانه</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSaveAttendance} className="space-y-3">
                <div>
                  <Label>کارمند</Label>
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
                    <Label>روزهای کارکرد</Label>
                    <Input
                      type="number"
                      min={0}
                      max={31}
                      value={attWorkDays}
                      onChange={(e) => setAttWorkDays(Number(e.target.value))}
                      required
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
                </div>
                <div className="grid grid-cols-2 gap-3">
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
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>غیبت (روز)</Label>
                    <Input
                      type="number"
                      min={0}
                      max={31}
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
                      value={attUnpaidLeave}
                      onChange={(e) => setAttUnpaidLeave(Number(e.target.value))}
                    />
                  </div>
                </div>
                <div>
                  <Label>توضیحات</Label>
                  <Input
                    placeholder="یادداشت اختیاری..."
                    value={attNotes}
                    onChange={(e) => setAttNotes(e.target.value)}
                  />
                </div>
                <div className="flex justify-end gap-2 pt-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowAttendanceModal(false)}
                  >
                    انصراف
                  </Button>
                  <Button type="submit">ثبت کارکرد</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 5: REQUEST LEAVE                                         */}
      {/* ============================================================== */}
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
                    {Object.entries(LEAVE_TYPE_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>از تاریخ</Label>
                    <Input
                      placeholder="۱۴۰۵/۰۱/۱۵"
                      value={leaveStart}
                      onChange={(e) => setLeaveStart(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <Label>تا تاریخ</Label>
                    <Input
                      placeholder="۱۴۰۵/۰۱/۱۷"
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
                    min={0.5}
                    step={0.5}
                    value={leaveDays}
                    onChange={(e) => setLeaveDays(Number(e.target.value))}
                    required
                  />
                </div>
                <div>
                  <Label>علت مرخصی</Label>
                  <Input
                    placeholder="توضیح کوتاه..."
                    value={leaveDesc}
                    onChange={(e) => setLeaveDesc(e.target.value)}
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

      {/* ============================================================== */}
      {/* MODAL 6: CREATE LOAN                                           */}
      {/* ============================================================== */}
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
