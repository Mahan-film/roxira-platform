"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowLeftRight, Plus, Store as StoreIcon, Trash2 } from "lucide-react";

import { ErrorNotice, loadErrorMessage } from "@/components/app/app-ui";
import { SkuInput } from "@/components/inventory/sku-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Drawer } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiClientError } from "@/lib/api/http-client";
import {
  createStore,
  createTransfer,
  createWarehouse,
  listStores,
  updateStore,
  updateWarehouse,
} from "@/lib/api/inventory-client";
import { formatNumber } from "@/lib/fa-format";
import type { Store, Warehouse } from "@/types/inventory";

type Panel = "store" | "warehouse" | "transfer" | null;

const SELECT_CLASS =
  "h-8 w-full rounded-lg border border-input bg-background px-2 text-sm";

function errorLines(error: unknown): string[] {
  return error instanceof ApiClientError
    ? error.details
    : ["ارتباط با سرور برقرار نشد."];
}

interface WarehousesManagerProps {
  warehouses: Warehouse[];
  onChanged: () => void;
}

/** Stores, warehouses and transfers between warehouses, each form in a drawer. */
export function WarehousesManager({ warehouses, onChanged }: WarehousesManagerProps) {
  const [stores, setStores] = useState<Store[]>([]);
  const [panel, setPanel] = useState<Panel>(null);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const [storeCode, setStoreCode] = useState("");
  const [storeName, setStoreName] = useState("");
  const [storeAddress, setStoreAddress] = useState("");

  const [whName, setWhName] = useState("");
  const [whCode, setWhCode] = useState("");
  const [whStore, setWhStore] = useState("");

  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState([{ uid: 1, sku: "", quantity: "" }]);

  const loadStores = useCallback(() => {
    const controller = new AbortController();
    listStores(controller.signal)
      .then(setStores)
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(loadErrorMessage(err));
      });
    return () => controller.abort();
  }, []);

  useEffect(() => loadStores(), [loadStores]);

  const activeWarehouses = warehouses.filter((w) => w.isActive);
  const storeName_ = (id: number | null) =>
    id === null ? "—" : stores.find((s) => s.id === id)?.name ?? "—";

  function close() {
    setPanel(null);
    setErrors(null);
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setErrors(null);
    try {
      await action();
      close();
      loadStores();
      onChanged();
    } catch (err) {
      setErrors(errorLines(err));
    } finally {
      setBusy(false);
    }
  }

  function submitStore(event: FormEvent) {
    event.preventDefault();
    if (!storeCode.trim() || storeName.trim().length < 2) {
      setErrors(["کد و نام فروشگاه الزامی است."]);
      return;
    }
    void run(async () => {
      await createStore({
        code: storeCode.trim(),
        name: storeName.trim(),
        address: storeAddress.trim() || undefined,
      });
      setStoreCode("");
      setStoreName("");
      setStoreAddress("");
    });
  }

  function submitWarehouse(event: FormEvent) {
    event.preventDefault();
    if (whName.trim().length < 2 || whCode.trim().length < 2) {
      setErrors(["نام و کد مکانی انبار الزامی است."]);
      return;
    }
    void run(async () => {
      await createWarehouse({
        name: whName.trim(),
        locationCode: whCode.trim(),
        storeId: whStore ? Number(whStore) : undefined,
      });
      setWhName("");
      setWhCode("");
      setWhStore("");
    });
  }

  function submitTransfer(event: FormEvent) {
    event.preventDefault();
    const valid = lines.filter((l) => l.sku.trim() && Number(l.quantity) > 0);
    if (!fromId || !toId || fromId === toId) {
      setErrors(["انبار مبدأ و مقصد را متفاوت انتخاب کنید."]);
      return;
    }
    if (valid.length === 0) {
      setErrors(["حداقل یک سطر با کد کالا و مقدار لازم است."]);
      return;
    }
    void run(async () => {
      await createTransfer({
        fromWarehouseId: Number(fromId),
        toWarehouseId: Number(toId),
        note: note.trim() || undefined,
        lines: valid.map((l) => ({ sku: l.sku.trim(), quantity: Number(l.quantity) })),
      });
      setLines([{ uid: Date.now(), sku: "", quantity: "" }]);
      setNote("");
    });
  }

  async function toggleStore(store: Store) {
    setError(null);
    try {
      await updateStore(store.id, { isActive: !store.isActive });
      loadStores();
    } catch (err) {
      setError(errorLines(err).join(" "));
    }
  }

  async function toggleWarehouse(warehouse: Warehouse) {
    setError(null);
    try {
      await updateWarehouse(warehouse.id, { isActive: !warehouse.isActive });
      onChanged();
    } catch (err) {
      setError(errorLines(err).join(" "));
    }
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <StoreIcon className="size-4 text-indigo-500" />
          فروشگاه‌ها و انبارها
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setPanel("store")}>
            <Plus /> فروشگاه جدید
          </Button>
          <Button size="sm" variant="outline" onClick={() => setPanel("warehouse")}>
            <Plus /> انبار جدید
          </Button>
          <Button
            size="sm"
            onClick={() => setPanel("transfer")}
            disabled={activeWarehouses.length < 2}
            title={activeWarehouses.length < 2 ? "برای انتقال حداقل دو انبار فعال لازم است" : undefined}
          >
            <ArrowLeftRight /> انتقال بین انبارها
          </Button>
        </div>
      </div>

      <ErrorNotice title="خطا" message={error} />

      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>فروشگاه</TableHead>
              <TableHead>کد</TableHead>
              <TableHead>انبارها</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {stores.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-4 text-center text-muted-foreground">
                  فروشگاهی تعریف نشده است.
                </TableCell>
              </TableRow>
            ) : (
              stores.map((store) => (
                <TableRow key={store.id}>
                  <TableCell>
                    {store.name}
                    {!store.isActive && <Badge variant="secondary" className="ms-2">غیرفعال</Badge>}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{store.code}</TableCell>
                  <TableCell>{formatNumber(store.warehouseCount)}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => void toggleStore(store)}>
                      {store.isActive ? "غیرفعال" : "فعال"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>انبار</TableHead>
              <TableHead>فروشگاه</TableHead>
              <TableHead>کد مکانی</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {warehouses.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-4 text-center text-muted-foreground">
                  انباری تعریف نشده است.
                </TableCell>
              </TableRow>
            ) : (
              warehouses.map((warehouse) => (
                <TableRow key={warehouse.id}>
                  <TableCell>
                    {warehouse.name}
                    {!warehouse.isActive && <Badge variant="secondary" className="ms-2">غیرفعال</Badge>}
                  </TableCell>
                  <TableCell>{storeName_(warehouse.storeId)}</TableCell>
                  <TableCell className="font-mono text-xs">{warehouse.locationCode}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => void toggleWarehouse(warehouse)}>
                      {warehouse.isActive ? "غیرفعال" : "فعال"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Drawer open={panel === "store"} size="md" title="فروشگاه جدید" onClose={close}>
        <form className="grid gap-4" onSubmit={submitStore} noValidate>
          <div className="grid gap-2">
            <Label htmlFor="store-code">کد فروشگاه</Label>
            <Input id="store-code" dir="ltr" value={storeCode} onChange={(e) => setStoreCode(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="store-name">نام فروشگاه</Label>
            <Input id="store-name" value={storeName} onChange={(e) => setStoreName(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="store-address">نشانی</Label>
            <Input id="store-address" value={storeAddress} onChange={(e) => setStoreAddress(e.target.value)} />
          </div>
          <FormFooter errors={errors} busy={busy} submitLabel="ایجاد فروشگاه" onCancel={close} />
        </form>
      </Drawer>

      <Drawer open={panel === "warehouse"} size="md" title="انبار جدید" onClose={close}>
        <form className="grid gap-4" onSubmit={submitWarehouse} noValidate>
          <div className="grid gap-2">
            <Label htmlFor="wh-name">نام انبار</Label>
            <Input id="wh-name" value={whName} onChange={(e) => setWhName(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="wh-code">کد مکانی</Label>
            <Input id="wh-code" dir="ltr" value={whCode} onChange={(e) => setWhCode(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="wh-store">فروشگاه (اختیاری)</Label>
            <select id="wh-store" className={SELECT_CLASS} value={whStore} onChange={(e) => setWhStore(e.target.value)}>
              <option value="">بدون فروشگاه</option>
              {stores.filter((s) => s.isActive).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <FormFooter errors={errors} busy={busy} submitLabel="ایجاد انبار" onCancel={close} />
        </form>
      </Drawer>

      <Drawer
        open={panel === "transfer"}
        size="lg"
        title="انتقال بین انبارها"
        description="لایه‌های FIFO با همان بها و تاریخ ورود به انبار مقصد منتقل می‌شوند."
        onClose={close}
      >
        <form className="grid gap-4" onSubmit={submitTransfer} noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="tr-from">از انبار</Label>
              <select id="tr-from" className={SELECT_CLASS} value={fromId} onChange={(e) => setFromId(e.target.value)}>
                <option value="">انتخاب…</option>
                {activeWarehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tr-to">به انبار</Label>
              <select id="tr-to" className={SELECT_CLASS} value={toId} onChange={(e) => setToId(e.target.value)}>
                <option value="">انتخاب…</option>
                {activeWarehouses.filter((w) => String(w.id) !== fromId).map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid gap-2">
            {lines.map((line) => (
              <div key={line.uid} className="grid grid-cols-[1fr_8rem_auto] items-center gap-2">
                <SkuInput
                  value={line.sku}
                  onChange={(sku) =>
                    setLines((prev) => prev.map((l) => (l.uid === line.uid ? { ...l, sku } : l)))
                  }
                />
                <Input
                  dir="ltr"
                  inputMode="decimal"
                  aria-label="مقدار"
                  placeholder="مقدار"
                  value={line.quantity}
                  onChange={(e) =>
                    setLines((prev) => prev.map((l) => (l.uid === line.uid ? { ...l, quantity: e.target.value } : l)))
                  }
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="حذف سطر"
                  disabled={lines.length === 1}
                  onClick={() => setLines((prev) => prev.filter((l) => l.uid !== line.uid))}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-fit"
              onClick={() => setLines((prev) => [...prev, { uid: Date.now(), sku: "", quantity: "" }])}
            >
              <Plus /> سطر جدید
            </Button>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="tr-note">توضیح</Label>
            <Input id="tr-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <FormFooter errors={errors} busy={busy} submitLabel="ثبت انتقال" onCancel={close} />
        </form>
      </Drawer>
    </Card>
  );
}

function FormFooter({
  errors,
  busy,
  submitLabel,
  onCancel,
}: {
  errors: string[] | null;
  busy: boolean;
  submitLabel: string;
  onCancel: () => void;
}) {
  return (
    <>
      {errors && errors.length > 0 && (
        <ul className="list-disc space-y-1 ps-5 text-sm text-destructive" role="alert">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "در حال ثبت…" : submitLabel}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          انصراف
        </Button>
      </div>
    </>
  );
}
