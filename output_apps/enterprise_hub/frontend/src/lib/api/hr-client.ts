import {
  CalculatePayrollDto,
  CreateContractDto,
  CreateEmployeeDto,
  Employee,
  EmploymentContract,
  HrStats,
  IssuePayslipDto,
  PaginatedResponse,
  PayrollCalculation,
  Payslip,
  QueryEmployeeDto,
  QueryPayslipDto,
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
