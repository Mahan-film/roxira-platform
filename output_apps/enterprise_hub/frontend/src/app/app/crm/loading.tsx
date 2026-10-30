import {
  AppPageSkeleton,
  FilterToolbarSkeleton,
  PageHeaderSkeleton,
  StatCardsSkeleton,
  TableCardSkeleton,
} from "@/components/app/page-skeleton";

export default function SuiteCrmLoading() {
  return (
    <AppPageSkeleton>
      <PageHeaderSkeleton actionCount={1} />
      <StatCardsSkeleton withSubtext />
      <FilterToolbarSkeleton filterCount={1} trailingActionCount={2} />
      <TableCardSkeleton columns={6} rows={6} />
    </AppPageSkeleton>
  );
}
