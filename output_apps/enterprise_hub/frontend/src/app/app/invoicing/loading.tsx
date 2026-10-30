import {
  AppPageSkeleton,
  FilterToolbarSkeleton,
  PageHeaderSkeleton,
  TableCardSkeleton,
} from "@/components/app/page-skeleton";

export default function SuiteInvoicingLoading() {
  return (
    <AppPageSkeleton>
      <PageHeaderSkeleton actionCount={1} />
      <FilterToolbarSkeleton filterCount={1} trailingActionCount={1} />
      <TableCardSkeleton columns={8} rows={6} />
    </AppPageSkeleton>
  );
}
