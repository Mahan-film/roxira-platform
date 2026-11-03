import {
  AppPageSkeleton,
  FilterToolbarSkeleton,
  PageHeaderSkeleton,
  StatCardsSkeleton,
  TableCardSkeleton,
} from "@/components/app/page-skeleton";

export default function SuitePayrollLoading() {
  return (
    <AppPageSkeleton>
      <PageHeaderSkeleton actionCount={1} />
      <StatCardsSkeleton withSubtext withFooterBanner />
      <FilterToolbarSkeleton filterCount={0} />
      <TableCardSkeleton columns={8} rows={5} withCardHeader />
    </AppPageSkeleton>
  );
}
