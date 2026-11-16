import { LoadingLine } from "@/components/app/app-ui";

export default function QuotationsLoading() {
  return (
    <div className="flex h-64 items-center justify-center">
      <LoadingLine show={true} />
    </div>
  );
}
