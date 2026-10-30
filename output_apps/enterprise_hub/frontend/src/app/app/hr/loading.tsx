import {
  AppPageSkeleton,
  FilterToolbarSkeleton,
  PageHeaderSkeleton,
  StatCardsSkeleton,
  TableCardSkeleton,
} from "@/components/app/page-skeleton";

export default function SuiteHrLoading() {
  return (
    <AppPageSkeleton>
      <PageHeaderSkeleton actionCount={2} />
      <StatCardsSkeleton withSubtext withFooterBanner />
      <FilterToolbarSkeleton filterCount={0} />
      <TableCardSkeleton columns={8} rows={5} withCardHeader />
      <TableCardSkeleton columns={6} rows={4} withCardHeader />
    </AppPageSkeleton>
  );
}
