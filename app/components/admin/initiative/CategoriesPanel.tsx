import { useEffect, useState } from "react";
import { Button } from "~/components/ui/Button";
import CategoriesPicker from "~/components/initiative-form/CategoriesPicker";
import { useAdminApi } from "~/hooks/use-admin-api";
import type { AdminInitiative } from "~/lib/api-types";
import type { Run } from "./run";

/** Beside the status controls: 1 to 3 categories, first is primary. Editable
 * in every status and never a text revision; approval needs at least one. */
export default function CategoriesPanel({ r, run }: { r: AdminInitiative; run: Run }) {
  const adminApi = useAdminApi();
  const [value, setValue] = useState(r.categories);
  const [busy, setBusy] = useState(false);
  const saved = r.categories.join();
  useEffect(() => setValue(r.categories), [saved]);
  const dirty = value.join() !== saved;
  return (
    <div className="panel">
      <span className="k">Categories</span>
      <CategoriesPicker label="Tags" id="admin-categories" value={value} onChange={setValue} />
      <div className="mt-3 flex items-center gap-2.5">
        <Button
          sm
          loading={busy}
          disabled={!dirty || !value.length}
          onClick={() => {
            setBusy(true);
            void run(
              () =>
                adminApi(`/api/admin/initiatives/${r.id}`, {
                  method: "PATCH",
                  json: { categories: value },
                }),
              "Categories saved.",
            ).finally(() => setBusy(false));
          }}
        >
          Save categories
        </Button>
        {!r.categories.length && <span className="small text-dao-amber">Untagged</span>}
      </div>
    </div>
  );
}
