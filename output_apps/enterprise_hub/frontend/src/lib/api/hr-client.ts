import {
  CalculatePayrollDto,
  CreateContractDto,
  CreateEmployeeDto,
  CreatePayrollRunDto,
  Employee,
  EmploymentContract,
  HrStats,
  InsuranceList,
  InsuranceListQuery,
  IssuePayslipDto,
  PaginatedResponse,
  PayrollCalculation,
  PayrollRates,
  PayrollRun,
  Payslip,
  QueryEmployeeDto,
  QueryPayslipDto,
  SetStatutoryParameterDto,
  StatutoryParameter,
} from "@/types/hr";
import { apiRequest } from "@/lib/api/http-client";
import { API_PROXY_BASE_PATH, HR_RESOURCE_PATH } from "@/lib/api/config";

// از پروکسی هم‌مبدأ next.config.ts (`rewrites`) عبور می‌کند تا مشکل CORS
// رخ ندهد و آدرس واقعی سرویس NestJS در کد سمت مرورگر افشا نشود.
const HR_ENDPOINT = `${API_PROXY_BASE_PATH}/${HR_RESOURCE_PATH}`;

/** فهرست صفحه‌بندی‌شده پرسنل — GET /enterprise-hub/hr/employees */
export async function listEmployees(
  params: QueryEmployeeDto = {},
  signal?: AbortSignal,
): Promise<PaginatedResponse<Employee>> {
  return apiRequest<PaginatedResponse<Employee>>(`${HR_ENDPOINT}/employees`, {
    method: "GET",
    searchParams: {
      page: params.page,
      limit: params.limit,
      search: params.search,
      status: params.status,
      department: params.department,
    },
    signal,
  });
}

/** ثبت پرسنل جدید — POST /enterprise-hub/hr/employees */
export async function createEmployee(
  payload: CreateEmployeeDto,
  signal?: AbortSignal,
): Promise<Employee> {
  return apiRequest<Employee>(`${HR_ENDPOINT}/employees`, {
    method: "POST",
    body: payload,
    signal,
  });
}

/** دریافت پرونده کارمند — GET /enterprise-hub/hr/employees/:id */
export async function getEmployee(
  id: number,
  signal?: AbortSignal,
): Promise<Employee> {
  return apiRequest<Employee>(`${HR_ENDPOINT}/employees/${id}`, {
    method: "GET",
    signal,
  });
}

/** ویرایش پرونده کارمند — PATCH /enterprise-hub/hr/employees/:id */
export async function updateEmployee(
  id: number,
  payload: Partial<CreateEmployeeDto>,
  signal?: AbortSignal,
): Promise<Employee> {
  return apiRequest<Employee>(`${HR_ENDPOINT}/employees/${id}`, {
    method: "PATCH",
    body: payload,
    signal,
  });
}

/** فهرست قراردادهای حقوقی — GET /enterprise-hub/hr/contracts */
export async function listContracts(
  employeeId?: number,
  signal?: AbortSignal,
): Promise<EmploymentContract[]> {
  return apiRequest<EmploymentContract[]>(`${HR_ENDPOINT}/contracts`, {
    method: "GET",
    searchParams: { employeeId },
    signal,
  });
}

/** تعریف قرارداد/حکم حقوقی — POST /enterprise-hub/hr/contracts */
export async function createContract(
  payload: CreateContractDto,
  signal?: AbortSignal,
): Promise<EmploymentContract> {
  return apiRequest<EmploymentContract>(`${HR_ENDPOINT}/contracts`, {
    method: "POST",
    body: payload,
    signal,
  });
}

/** پیش‌محاسبه حقوق — POST /enterprise-hub/hr/payroll/calculate */
export async function calculatePayroll(
  payload: CalculatePayrollDto,
  signal?: AbortSignal,
): Promise<PayrollCalculation> {
  return apiRequest<PayrollCalculation>(`${HR_ENDPOINT}/payroll/calculate`, {
    method: "POST",
    body: payload,
    signal,
  });
}

/** صدور فیش حقوقی و ثبت سند خودکار — POST /enterprise-hub/hr/payslips */
export async function issuePayslip(
  payload: IssuePayslipDto,
  signal?: AbortSignal,
): Promise<Payslip> {
  return apiRequest<Payslip>(`${HR_ENDPOINT}/payslips`, {
    method: "POST",
    body: payload,
    signal,
  });
}

/** فهرست صفحه‌بندی‌شده فیش‌های حقوقی — GET /enterprise-hub/hr/payslips */
export async function listPayslips(
  params: QueryPayslipDto = {},
  signal?: AbortSignal,
): Promise<PaginatedResponse<Payslip>> {
  return apiRequest<PaginatedResponse<Payslip>>(`${HR_ENDPOINT}/payslips`, {
    method: "GET",
    searchParams: {
      page: params.page,
      limit: params.limit,
      employeeId: params.employeeId,
      periodYear: params.periodYear,
      periodMonth: params.periodMonth,
    },
    signal,
  });
}

/** آمار تحلیلی منابع انسانی — GET /enterprise-hub/hr/stats */
export async function getHrStats(signal?: AbortSignal): Promise<HrStats> {
  return apiRequest<HrStats>(`${HR_ENDPOINT}/stats`, {
    method: "GET",
    signal,
  });
}

/** نرخ‌های قانونی حقوق یک سال شمسی — GET /enterprise-hub/hr/payroll-rates/:year */
export async function getPayrollRates(
  year: number,
  signal?: AbortSignal,
): Promise<PayrollRates> {
  return apiRequest<PayrollRates>(`${HR_ENDPOINT}/payroll-rates/${year}`, {
    method: "GET",
    signal,
  });
}

/** مقادیر قانونی جاری یک سال — GET /enterprise-hub/hr/statutory-parameters/:year */
export async function listStatutoryParameters(
  year: number,
  signal?: AbortSignal,
): Promise<StatutoryParameter[]> {
  return apiRequest<StatutoryParameter[]>(`${HR_ENDPOINT}/statutory-parameters/${year}`, {
    method: "GET",
    signal,
  });
}

/** ثبت نسخه جدید یک مقدار قانونی — PUT /enterprise-hub/hr/statutory-parameters */
export async function setStatutoryParameter(
  payload: SetStatutoryParameterDto,
): Promise<StatutoryParameter[]> {
  return apiRequest<StatutoryParameter[]>(`${HR_ENDPOINT}/statutory-parameters`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

/** محاسبه یا محاسبه مجدد حقوق ماه — POST /enterprise-hub/hr/payroll-runs */
export async function createPayrollRun(
  payload: CreatePayrollRunDto,
  signal?: AbortSignal,
): Promise<PayrollRun> {
  return apiRequest<PayrollRun>(`${HR_ENDPOINT}/payroll-runs`, {
    method: "POST",
    body: payload,
    signal,
  });
}

/** فهرست اجراهای ماهانه حقوق — GET /enterprise-hub/hr/payroll-runs */
export async function listPayrollRuns(signal?: AbortSignal): Promise<PayrollRun[]> {
  return apiRequest<PayrollRun[]>(`${HR_ENDPOINT}/payroll-runs`, {
    method: "GET",
    signal,
  });
}

/** جزئیات اجرای حقوق — GET /enterprise-hub/hr/payroll-runs/:id */
export async function getPayrollRun(
  id: number,
  signal?: AbortSignal,
): Promise<PayrollRun> {
  return apiRequest<PayrollRun>(`${HR_ENDPOINT}/payroll-runs/${id}`, {
    method: "GET",
    signal,
  });
}

/** ثبت سند حسابداری اجرای حقوق — POST /enterprise-hub/hr/payroll-runs/:id/post */
export async function postPayrollRun(
  id: number,
  signal?: AbortSignal,
): Promise<PayrollRun> {
  return apiRequest<PayrollRun>(`${HR_ENDPOINT}/payroll-runs/${id}/post`, {
    method: "POST",
    signal,
  });
}

/** لیست بیمه (DSKKAR00/DSKWOR00) — GET /enterprise-hub/hr/payroll-runs/:id/insurance-list */
export async function getInsuranceList(
  id: number,
  query: InsuranceListQuery,
  signal?: AbortSignal,
): Promise<InsuranceList> {
  return apiRequest<InsuranceList>(`${HR_ENDPOINT}/payroll-runs/${id}/insurance-list`, {
    method: "GET",
    searchParams: { ...query },
    signal,
  });
}
