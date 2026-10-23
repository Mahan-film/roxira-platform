"use client";

import { useState, type FormEvent } from "react";

import { ErrorNotice, loadErrorMessage } from "@/components/app/app-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateEmployee } from "@/lib/api/hr-client";
import type { Employee } from "@/types/hr";

interface EmployeeEditPanelProps {
  employee: Employee;
  onSaved: (employee: Employee) => void;
  onClose: () => void;
}

/** Edit the common fields of an employee (PATCH /enterprise-hub/hr/employees/:id). */
export function EmployeeEditPanel({ employee, onSaved, onClose }: EmployeeEditPanelProps) {
  const [firstName, setFirstName] = useState(employee.firstName);
  const [lastName, setLastName] = useState(employee.lastName);
  const [mobile, setMobile] = useState(employee.mobile);
  const [email, setEmail] = useState(employee.email ?? "");
  const [jobTitle, setJobTitle] = useState(employee.jobTitle);
  const [department, setDepartment] = useState(employee.department);
  const [insuranceNumber, setInsuranceNumber] = useState(
    employee.insuranceNumber ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const updated = await updateEmployee(employee.id, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        mobile: mobile.trim(),
        email: email.trim() || undefined,
        jobTitle: jobTitle.trim(),
        department: department.trim(),
        insuranceNumber: insuranceNumber.trim() || undefined,
      });
      onSaved(updated);
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const fields: Array<[string, string, (v: string) => void, string, boolean]> = [
    ["نام", firstName, setFirstName, "first", false],
    ["نام خانوادگی", lastName, setLastName, "last", false],
    ["موبایل", mobile, setMobile, "mobile", true],
    ["ایمیل", email, setEmail, "email", true],
    ["عنوان شغلی", jobTitle, setJobTitle, "job", false],
    ["واحد / دپارتمان", department, setDepartment, "dept", false],
    ["شماره بیمه", insuranceNumber, setInsuranceNumber, "insurance", true],
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>ویرایش {employee.fullName}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {fields.map(([label, value, setter, id, ltr]) => (
              <div key={id} className="flex flex-col gap-1.5">
                <Label htmlFor={`emp-edit-${id}`}>{label}</Label>
                <Input
                  id={`emp-edit-${id}`}
                  value={value}
                  dir={ltr ? "ltr" : undefined}
                  onChange={(e) => setter(e.target.value)}
                />
              </div>
            ))}
          </div>
          <ErrorNotice title="ذخیره انجام نشد" message={error} />
          <div className="flex gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? "در حال ذخیره..." : "ذخیره تغییرات"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              انصراف
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
