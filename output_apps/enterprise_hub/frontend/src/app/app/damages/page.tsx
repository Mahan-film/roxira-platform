"use client";

import { Scale } from "lucide-react";

import { PageHeader } from "@/components/app/app-ui";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { DamageCalculatorSection } from "@/components/damages/damage-calculator-section";
import { DamageHistoryTable } from "@/components/damages/damage-history-table";

export default function SuiteDamagesPage() {
  return (
    <EnterpriseRouteGuard>
      <PageHeader
        title="خسارت تاخیر تادیه"
        description="محاسبه رسمی بر پایه شاخص بانک مرکزی (ماده ۵۲۲ قانون آیین دادرسی مدنی) یا نرخ سود قراردادی، همراه با سوابق محاسبات"
        icon={<Scale className="size-6 text-indigo-500" />}
      />
      <DamageCalculatorSection />
      <section className="mt-8 flex flex-col gap-3">
        <h2 className="text-lg font-semibold">سوابق محاسبات</h2>
        <DamageHistoryTable />
      </section>
    </EnterpriseRouteGuard>
  );
}
