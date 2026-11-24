import {
  AppPageSkeleton,
  FilterToolbarSkeleton,
  PageHeaderSkeleton,
  StatCardsSkeleton,
  TableCardSkeleton,
} from "@/components/app/page-skeleton";

export default function SalesLoading() {
  return (
    <AppPageSkeleton>
      <PageHeaderSkeleton />
      <StatCardsSkeleton count={4} />
      <FilterToolbarSkeleton filterCount={2} />
      <TableCardSkeleton columns={7} rows={6} withCardHeader />
    </AppPageSkeleton>
  );
}
